/**
 * 飞书 OAuth2 自定义 Provider（适配 NextAuth v4）
 *
 * 使用飞书标准 OAuth 流程（非 OIDC），适用于所有企业自建应用：
 * 1. 前端跳飞书授权页拿 code
 * 2. 用 app_access_token 换 user_access_token
 * 3. 用 user_access_token 拿用户信息
 */

import type { OAuthConfig, OAuthUserConfig } from "next-auth/providers/oauth";

export interface FeishuProfile {
  sub:        string;
  name:       string;
  picture:    string;
  open_id:    string;
  union_id:   string;
  en_name:    string;
  email:      string;
  mobile:     string;
  avatar_url: string;
  tenant_key: string;
}

export function FeishuProvider<P extends FeishuProfile>(
  options: OAuthUserConfig<P>
): OAuthConfig<P> {
  return {
    id: "feishu",
    name: "飞书",
    type: "oauth",

    authorization: {
      url: "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
      // NextAuth v4 默认会附加 scope=openid，但飞书不支持 OIDC openid scope（错误码 20043）
      // 显式传空字符串以覆盖默认值，飞书 authen/v1 授权无需 scope 参数
      params: { response_type: "code", scope: "" },
    },

    // Step 1 → Step 2: 标准 OAuth 2.0 — 用 client_id + client_secret + code 换 user_access_token
    // 使用飞书新版接口 authen/v2/oauth/token（旧版 authen/v1/access_token 已废弃，审批后不可用）
    token: {
      url: "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
      async request({ params, provider }) {
        const appId     = provider.clientId!;
        const appSecret = provider.clientSecret!;

        const res = await fetch(
          "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
          {
            method:  "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              grant_type:    "authorization_code",
              client_id:     appId,
              client_secret: appSecret,
              code:          params.code,
              redirect_uri:  provider.callbackUrl,
            }),
          }
        );
        const json = await res.json();
        // v2 接口成功时无 code 字段，直接含 access_token
        if (!json.access_token) {
          console.error("[Feishu] 获取 user_access_token 失败:", json);
          throw new Error(`Feishu token 失败: ${json.error_description ?? json.error ?? JSON.stringify(json)}`);
        }

        return {
          tokens: {
            access_token:  json.access_token,
            token_type:    json.token_type    ?? "Bearer",
            expires_in:    json.expires_in,
            refresh_token: json.refresh_token ?? null,
          },
        };
      },
    },

    // Step 3: 用 user_access_token 拿用户信息
    userinfo: {
      url: "https://open.feishu.cn/open-apis/authen/v1/user_info",
      async request({ tokens }) {
        const res = await fetch(
          "https://open.feishu.cn/open-apis/authen/v1/user_info",
          {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          }
        );
        const json = await res.json();
        if (json.code !== 0) {
          console.error("[Feishu] 获取用户信息失败:", json);
          throw new Error(`Feishu user_info 失败: code=${json.code} msg=${json.msg}`);
        }
        const d = json.data;
        if (!d?.open_id) {
          console.error("[Feishu] user_info 无 open_id:", json);
          throw new Error(`Feishu user_info 无 open_id: ${JSON.stringify(json)}`);
        }
        return {
          sub:        d.open_id,
          name:       d.name       ?? d.en_name ?? "飞书用户",
          picture:    d.avatar_url ?? d.picture  ?? "",
          open_id:    d.open_id,
          union_id:   d.union_id   ?? "",
          en_name:    d.en_name    ?? "",
          email:      d.email      ?? d.enterprise_email ?? "",
          mobile:     d.mobile     ?? "",
          avatar_url: d.avatar_url ?? d.picture  ?? "",
          tenant_key: d.tenant_key ?? "",
        } as P;
      },
    },

    profile(profile) {
      return {
        id:             profile.open_id,
        name:           profile.name,
        email:          profile.email || null,
        image:          profile.avatar_url,
        feishuUserId:   profile.open_id,
        feishuUnionId:  profile.union_id,
        role:           "DEPT_CONTACT" as const,
        departmentId:   null,
      };
    },

    style: {
      logo: "https://sf3-cn.feishucdn.com/obj/feishu-static/feishu/homepage/FeishuLogo.png",
      bg:   "#00d6a2",
      text: "#fff",
    },

    options,
  };
}
