"use client";

import { useState, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Already authenticated → skip login page entirely
  useEffect(() => {
    if (status === "authenticated" && session) {
      router.replace(
        session.user.role === "DEPT_CONTACT"
          ? "/dashboard/my-tasks"
          : "/dashboard/tasks"
      );
    }
  }, [status, session, router]);

  // Show nothing while checking session (avoids flash of login form)
  if (status === "loading" || status === "authenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0b1120 0%, #0f2040 60%, #0b1120 100%)" }}>
        <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("邮箱或密码错误，请重试");
    } else {
      router.push("/dashboard/tasks");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0b1120 0%, #0f2040 60%, #0b1120 100%)" }}>
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full opacity-10" style={{ background: "radial-gradient(circle, #3b82f6, transparent)" }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full opacity-10" style={{ background: "radial-gradient(circle, #06b6d4, transparent)" }} />
        {/* 网格线 */}
        <svg className="absolute inset-0 w-full h-full opacity-5" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#60a5fa" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <div className="relative w-full max-w-md mx-4 animate-fade-in">
        {/* Logo 区域 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M6 26V6l10 6 10-6v20l-10-6-10 6z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Momenta LPA</h1>
          <p className="text-sm mt-1" style={{ color: "#64748b" }}>政企数据协同与智库平台</p>
        </div>

        {/* 登录卡片 */}
        <div className="rounded-2xl p-8 shadow-2xl" style={{ background: "rgba(15, 23, 42, 0.8)", border: "1px solid #1e2d45", backdropFilter: "blur(20px)" }}>

          {/* 飞书登录（主要方式） */}
          <button
            onClick={() => signIn("feishu", { callbackUrl: "/dashboard/tasks" })}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl text-white font-medium transition-all duration-200 hover:opacity-90 active:scale-95 mb-6"
            style={{ background: "linear-gradient(135deg, #00a870, #00d6a2)" }}
          >
            <svg width="20" height="20" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="8" fill="white" fillOpacity="0.2" />
              <path d="M20 8C13.373 8 8 13.373 8 20s5.373 12 12 12 12-5.373 12-12S26.627 8 20 8z" fill="white" />
              <path d="M15 17l5 3 5-3v6l-5 3-5-3v-6z" fill="#00a870" />
            </svg>
            使用飞书账号登录
          </button>

          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px" style={{ background: "#1e2d45" }} />
            <span className="text-xs" style={{ color: "#475569" }}>或使用内部账号</span>
            <div className="flex-1 h-px" style={{ background: "#1e2d45" }} />
          </div>

          {/* 账号密码登录 */}
          <form onSubmit={handleCredentials} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "#94a3b8" }}>邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@momenta.ai"
                required
                className="w-full px-4 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 outline-none transition-all"
                style={{ background: "#0f172a", border: "1px solid #1e2d45" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#3b82f6")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2d45")}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "#94a3b8" }}>密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full px-4 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 outline-none transition-all"
                style={{ background: "#0f172a", border: "1px solid #1e2d45" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#3b82f6")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#1e2d45")}
              />
            </div>

            {error && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ color: "#f87171", background: "rgba(239,68,68,0.1)" }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl text-sm font-medium text-white transition-all duration-200 hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}
            >
              {loading ? "登录中..." : "登录"}
            </button>
          </form>
        </div>

        <p className="text-center mt-6 text-xs" style={{ color: "#334155" }}>
          © 2025 Momenta Inc. · 仅限内部使用 · 所有操作均被审计记录
        </p>
      </div>
    </div>
  );
}
