/**
 * NextAuth v4 核心配置
 * - 支持飞书 SSO (生产) 和 Credentials (本地开发)
 * - 自动同步飞书用户到本地 users 表
 * - Session 中注入用户角色，供中间件鉴权使用
 */

import { NextAuthOptions, getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { FeishuProvider } from "@/lib/feishu-provider";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: UserRole;
      departmentId: string | null;
    };
  }
  interface User {
    role: UserRole;
    departmentId: string | null;
    feishuUserId?: string;
    feishuUnionId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: UserRole;
    departmentId: string | null;
    userId: string;
    // 飞书用户 token（用于访问用户有权限的 Bitable）
    feishuAccessToken?:    string;
    feishuRefreshToken?:   string;
    feishuTokenExpiresAt?: number; // ms timestamp
  }
}

const THIRTY_DAYS = 30 * 24 * 60 * 60; // 2 592 000 s

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge:    THIRTY_DAYS,       // JWT 有效期 30 天
    updateAge: 24 * 60 * 60,      // 每 24 h 滚动刷新 cookie 过期时间
  },

  jwt: {
    maxAge: THIRTY_DAYS,          // JWT token 签发时的 exp = now + 30d
  },

  // 显式声明持久化 cookie，避免浏览器将其当作会话 cookie 在关闭时清除
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production"
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path:     "/",
        secure:   process.env.NODE_ENV === "production",
        maxAge:   THIRTY_DAYS,    // 持久化：30 天后才过期，关闭浏览器不清除
      },
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  providers: [
    // ── 飞书 SSO（配置了 FEISHU_APP_ID 时启用）──────────────
    ...(process.env.FEISHU_APP_ID
      ? [
          FeishuProvider({
            clientId: process.env.FEISHU_APP_ID!,
            clientSecret: process.env.FEISHU_APP_SECRET!,
          }),
        ]
      : []),

    // ── 本地账号（开发/应急备用）────────────────────────────
    CredentialsProvider({
      name: "账号密码",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // ── 开发快捷登录（生产部署前必须移除）────────────────────
        // 所有账号统一用真实密码，不再提供 123456 后门，避免角色混淆问题

        const user = await prisma.user.findUnique({
          where: { email: credentials.email, isActive: true },
          include: { department: { select: { id: true, name: true } } },
        });

        if (!user || !user.passwordHash) return null;

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        // 更新最后登录时间
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.avatarUrl,
          role: user.role,
          departmentId: user.departmentId,
        };
      },
    }),
  ],

  callbacks: {
    // 飞书登录时自动同步/创建用户
    async signIn({ user, account, profile }) {
      if (account?.provider === "feishu" && profile) {
        const feishuProfile = profile as {
          open_id: string;
          union_id: string;
          name: string;
          email: string;
          avatar_url: string;
        };

        // 三级查找：open_id → union_id → email
        // 防止飞书邮箱与管理员预创建账号冲突触发 unique constraint
        let existing = await prisma.user.findUnique({
          where: { feishuUserId: feishuProfile.open_id },
        });

        if (!existing && feishuProfile.union_id) {
          existing = await prisma.user.findUnique({
            where: { feishuUnionId: feishuProfile.union_id },
          });
        }

        if (!existing && feishuProfile.email) {
          existing = await prisma.user.findUnique({
            where: { email: feishuProfile.email },
          });
        }

        if (existing) {
          // 如账号尚未绑定飞书 ID（如管理员预创建账号），补绑
          const updated = await prisma.user.update({
            where: { id: existing.id },
            data: {
              ...(existing.feishuUserId == null && { feishuUserId: feishuProfile.open_id }),
              ...(existing.feishuUnionId == null && feishuProfile.union_id
                ? { feishuUnionId: feishuProfile.union_id }
                : {}),
              name: feishuProfile.name,
              avatarUrl: feishuProfile.avatar_url,
              lastLoginAt: new Date(),
            },
          });
          user.id = updated.id;
          user.role = updated.role;
          user.departmentId = updated.departmentId;
        } else {
          // 真正的首次飞书登录，创建新用户
          const created = await prisma.user.create({
            data: {
              feishuUserId: feishuProfile.open_id,
              feishuUnionId: feishuProfile.union_id || null,
              name: feishuProfile.name,
              email: feishuProfile.email || `${feishuProfile.open_id}@feishu.local`,
              avatarUrl: feishuProfile.avatar_url,
              role: UserRole.DEPT_CONTACT,
              lastLoginAt: new Date(),
            },
          });
          user.id = created.id;
          user.role = created.role;
          user.departmentId = created.departmentId;
        }
      }
      return true;
    },

    async jwt({ token, user, account }) {
      // 飞书 OAuth 登录时保存 user_access_token 和 refresh_token
      if (account?.provider === "feishu" && account.access_token) {
        token.feishuAccessToken    = account.access_token as string;
        token.feishuRefreshToken   = (account.refresh_token ?? undefined) as string | undefined;
        token.feishuTokenExpiresAt = Date.now() + ((account.expires_in as number ?? 7200) - 300) * 1000;
      }
      if (user) {
        token.userId       = user.id;
        token.role         = user.role;
        token.departmentId = user.departmentId;
      }
      // 飞书 token 即将过期时静默续期
      if (
        token.feishuRefreshToken &&
        token.feishuTokenExpiresAt &&
        Date.now() > token.feishuTokenExpiresAt
      ) {
        try {
          const res  = await fetch("https://open.feishu.cn/open-apis/authen/v2/oauth/token", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              grant_type:    "refresh_token",
              client_id:     process.env.FEISHU_APP_ID,
              client_secret: process.env.FEISHU_APP_SECRET,
              refresh_token: token.feishuRefreshToken,
            }),
          });
          const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
          if (data.access_token) {
            token.feishuAccessToken    = data.access_token;
            token.feishuRefreshToken   = data.refresh_token ?? token.feishuRefreshToken;
            token.feishuTokenExpiresAt = Date.now() + ((data.expires_in ?? 7200) - 300) * 1000;
          }
        } catch {
          // 续期失败：保留旧 token，下次请求再试
        }
      }
      return token;
    },

    async session({ session, token }) {
      session.user.id = token.userId;
      session.user.role = token.role;
      session.user.departmentId = token.departmentId;
      return session;
    },
  },
};

export const getSession = () => getServerSession(authOptions);
