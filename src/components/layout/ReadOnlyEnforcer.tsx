"use client";

/**
 * 只读演示模式执行器（客户端组件）
 *
 * 由 dashboard/layout.tsx 在主内容区包裹，启用后：
 *   1. 给所有未带 data-allow-readonly 的 input/textarea/select 追加 readonly 属性
 *   2. 拦截主内容区所有 <form> 的 submit 事件（preventDefault）
 *   3. 在顶部 sticky 渲染一条"只读演示模式"提示横幅
 *   4. 监听 DOM 变化（路由切换后新页面也能生效）
 *
 * 注意：
 *   - 视觉灰化由 globals.css 的 [data-readonly="true"] 选择器处理（无需 className 拼接）
 *   - 此组件挂载位置必须在 dashboard 主内容 wrapper 内，与 data-readonly 属性同源
 *   - 用户邮箱以 data 属性透传，便于日志/调试，不参与行为判断
 */

import { useEffect, useRef } from "react";

interface ReadOnlyEnforcerProps {
  enabled: boolean;
  email?:   string | null;
}

const INPUT_SELECTOR =
  'input:not([type="hidden"]):not([data-allow-readonly]), textarea:not([data-allow-readonly]), select:not([data-allow-readonly])';

export function ReadOnlyEnforcer({ enabled, email }: ReadOnlyEnforcerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 1) 给所有 input/textarea/select 加 readonly 属性（视觉由 CSS 兜底）
  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current?.parentElement;
    if (!root) return;

    const apply = () => {
      const inputs = root.querySelectorAll<HTMLElement>(INPUT_SELECTOR);
      inputs.forEach((el) => {
        if (el instanceof HTMLInputElement) {
          if (el.type === "checkbox" || el.type === "radio") {
            el.disabled = true;
          } else {
            el.setAttribute("readonly", "readonly");
          }
        } else if (el instanceof HTMLTextAreaElement) {
          el.setAttribute("readonly", "readonly");
        } else if (el instanceof HTMLSelectElement) {
          el.setAttribute("disabled", "disabled");
        }
      });
    };

    apply();

    // 路由切换 / 新内容注入后再跑一次
    const observer = new MutationObserver(() => apply());
    observer.observe(root, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [enabled]);

  // 2) 拦截所有 <form> submit（数据写入）
  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current?.parentElement;
    if (!root) return;

    const onSubmit = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      // eslint-disable-next-line no-console
      console.warn("[只读演示模式] 表单提交被拦截");
    };

    root.addEventListener("submit", onSubmit, true);

    return () => root.removeEventListener("submit", onSubmit, true);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div ref={rootRef} aria-hidden="false">
      <div className="pa-readonly-banner" role="status">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 9v3.5M12 15.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
        <span>
          只读演示模式 — 当前账号 <strong>{email ?? "—"}</strong> 仅可查阅，表单输入与提交已被禁用
        </span>
      </div>
    </div>
  );
}
