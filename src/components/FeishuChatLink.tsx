"use client";

/**
 * FeishuChatLink — 点击后通过飞书 Applink 协议唤起与目标员工的私聊窗口。
 *
 * 使用方式：
 *   <FeishuChatLink email="zhang.san@momenta.ai">
 *     <Avatar ... />
 *   </FeishuChatLink>
 *
 * 原理：feishu://client/chat/open?email=xxx 在安装了飞书客户端的机器上
 * 会直接唤起飞书并打开与该邮箱对应账号的私聊。
 */

import { MessageCircle } from "lucide-react";

interface Props {
  email:     string | null | undefined;
  children:  React.ReactNode;
  showIcon?: boolean;   // 是否在右下角展示小图标提示（默认 true）
  className?: string;
}

export default function FeishuChatLink({
  email, children, showIcon = true, className = "",
}: Props) {
  if (!email) return <>{children}</>;

  const href = `https://applink.feishu.cn/client/chat/open?email=${encodeURIComponent(email)}`;

  return (
    <a
      href={href}
      title={`飞书私聊 ${email}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`relative inline-flex items-center group/fsl hover:opacity-80 transition-opacity ${className}`}
    >
      {children}
      {showIcon && (
        <span
          className="absolute -bottom-0.5 -right-0.5 opacity-0 group-hover/fsl:opacity-100 transition-opacity flex items-center justify-center rounded-full"
          style={{
            width:      14,
            height:     14,
            background: "#00d6a2",
            border:     "1.5px solid white",
          }}
        >
          <MessageCircle size={8} color="white" strokeWidth={2.5} />
        </span>
      )}
    </a>
  );
}
