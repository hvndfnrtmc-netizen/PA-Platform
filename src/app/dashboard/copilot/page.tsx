"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Square, RotateCcw, Database, Award, Sparkles, User, AlertCircle } from "lucide-react";

// ── 类型 ──────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: boolean;
  sourceCount?: { chunks: number; awards: number };
}

// ── 快捷提问模板 ─────────────────────────────────────────────────

const QUICK_PROMPTS = [
  { label: "🏆 省级以上荣誉", text: "帮我总结公司近三年获得的省级及以上荣誉" },
  { label: "🤝 感谢信起草", text: "帮我起草一份给江苏省工信厅的来访感谢信" },
  { label: "📊 财务研发摘要", text: "调取2024年度核心财务与研发投入数据摘要" },
  { label: "💡 政策趋势分析", text: "分析当前各地自动驾驶路权开放的政策趋势" },
];

// ── Markdown 链接渲染 ─────────────────────────────────────────────
// 将 [text](url) 渲染为可点击链接，同时处理 **bold** 语法

function renderContent(text: string): React.ReactNode[] {
  // 先按 **bold** 和 [link](url) 分段
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    // Markdown 链接
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-blue-500 hover:text-blue-600 underline underline-offset-2 transition-colors"
        >
          {linkMatch[1]}
        </a>
      );
    }
    // 粗体
    const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      return <strong key={i} className="font-semibold text-slate-800">{boldMatch[1]}</strong>;
    }
    // 普通文本（保留换行）
    if (!part) return null;
    return (
      <span key={i}>
        {part.split("\n").map((line, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {line}
          </span>
        ))}
      </span>
    );
  }).filter(Boolean) as React.ReactNode[];
}

// ── 消息气泡 ──────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div className="flex items-start gap-2.5 max-w-[75%]">
          <div
            className="rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-white leading-relaxed"
            style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}
          >
            {msg.content}
          </div>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-semibold mt-0.5"
            style={{ background: "linear-gradient(135deg, #475569, #334155)" }}
          >
            <User size={14} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-4">
      <div className="flex items-start gap-2.5 max-w-[85%]">
        {/* Copilot 头像 */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white mt-0.5"
          style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}
        >
          <Sparkles size={13} />
        </div>

        <div className="flex flex-col gap-1.5 min-w-0">
          <div
            className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed"
            style={{
              background: msg.error ? "#fef2f2" : "white",
              border: `1px solid ${msg.error ? "#fecaca" : "#e2e8f0"}`,
              color: msg.error ? "#dc2626" : "#1e293b",
            }}
          >
            {msg.error && (
              <div className="flex items-center gap-1.5 mb-1 text-red-500">
                <AlertCircle size={13} />
                <span className="text-xs font-medium">请求出错</span>
              </div>
            )}
            <div className="break-words">{renderContent(msg.content)}</div>
            {msg.streaming && (
              <span
                className="inline-block w-0.5 h-4 ml-0.5 rounded-full align-middle animate-pulse"
                style={{ background: "#3b82f6", verticalAlign: "text-bottom" }}
              />
            )}
          </div>

          {/* 数据源计数 */}
          {!msg.streaming && msg.sourceCount && (
            <div className="flex items-center gap-3 px-1">
              {msg.sourceCount.chunks > 0 && (
                <span className="flex items-center gap-1 text-xs" style={{ color: "#94a3b8" }}>
                  <Database size={10} />
                  检索了 {msg.sourceCount.chunks} 条指标
                </span>
              )}
              {msg.sourceCount.awards > 0 && (
                <span className="flex items-center gap-1 text-xs" style={{ color: "#94a3b8" }}>
                  <Award size={10} />
                  {msg.sourceCount.awards} 条奖项
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 欢迎屏幕 ──────────────────────────────────────────────────────

function WelcomeScreen({ onPrompt }: { onPrompt: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 px-8 py-12">
      {/* Logo */}
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}
      >
        <Sparkles size={28} className="text-white" />
      </div>
      <h2 className="text-xl font-bold text-slate-800 mb-2">智库chat</h2>
      <p className="text-sm text-slate-500 text-center max-w-sm mb-8 leading-relaxed">
        基于数据大盘与资质奖项库的智能问答助手，所有回答均附飞书溯源链接，严格防幻觉
      </p>

      {/* 防幻觉说明 */}
      <div
        className="flex items-start gap-3 px-4 py-3 rounded-xl mb-8 max-w-sm w-full text-xs"
        style={{ background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.15)" }}
      >
        <span className="text-blue-500 mt-0.5 flex-shrink-0">🛡</span>
        <span style={{ color: "#3b82f6" }}>
          每条回答必须挂载飞书溯源 URL，无来源数据自动触发「系统未收录」提示，不会臆造数据
        </span>
      </div>

      {/* 快捷提问 */}
      <p className="text-xs text-slate-400 mb-3 uppercase tracking-wider font-medium">快捷提问</p>
      <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p.label}
            onClick={() => onPrompt(p.text)}
            className="text-left px-3 py-2.5 rounded-xl text-xs transition-all hover:shadow-sm active:scale-98"
            style={{
              background: "white",
              border: "1px solid #e2e8f0",
              color: "#475569",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#3b82f6";
              e.currentTarget.style.color = "#2563eb";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#e2e8f0";
              e.currentTarget.style.color = "#475569";
            }}
          >
            <span className="font-medium block mb-0.5" style={{ color: "inherit" }}>{p.label}</span>
            <span className="text-slate-400 line-clamp-1">{p.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────

export default function CopilotPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // 发送消息
  const sendMessage = useCallback(async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || isStreaming) return;

    setInput("");

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    // 构建历史（不含最新两条，只传已完成的对话）
    const history = messages
      .filter((m) => !m.streaming && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: question, history }),
        signal:  abort.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "请求失败" }));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: errData.error ?? "请求失败", streaming: false, error: true }
              : m
          )
        );
        return;
      }

      const chunks = Number(res.headers.get("X-Retrieved-Chunks") ?? 0);
      const awards = Number(res.headers.get("X-Retrieved-Awards") ?? 0);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: accumulated } : m
          )
        );
      }

      // 完成：标记 streaming=false，挂上数据源计数
      const hasError = accumulated.includes("[ERROR]");
      const displayContent = hasError
        ? accumulated
            .replace(/\[ERROR\]\s*AI 思考时间过长，请稍后重试/g, "AI 思考时间过长，请稍后重试")
            .replace(/\[ERROR\]\s*(Request timed out\.?|fetch failed[^]*)/, "AI 思考时间过长，请稍后重试")
            .replace(/\[ERROR\]\s*/g, "")
            .trim() || "请求出错，请稍后重试"
        : accumulated;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content:     displayContent,
                streaming:   false,
                sourceCount: { chunks, awards },
                error:       hasError,
              }
            : m
        )
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "网络异常，请稍后重试", streaming: false, error: true }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }, [input, isStreaming, messages]);

  const stopStreaming = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    );
  };

  const clearChat = () => {
    if (isStreaming) stopStreaming();
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* 顶栏 */}
      <div
        className="flex items-center justify-between px-6 py-4 flex-shrink-0"
        style={{ background: "white", borderBottom: "1px solid #e2e8f0" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}
          >
            <Sparkles size={15} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">智库chat</p>
            <p className="text-xs text-slate-400">RAG 驱动 · 防幻觉 · 溯源可查</p>
          </div>
        </div>

        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <RotateCcw size={12} />
            清空对话
          </button>
        )}
      </div>

      {/* 消息区域 */}
      <div ref={bottomRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <WelcomeScreen onPrompt={(text) => sendMessage(text)} />
        ) : (
          <div className="px-6 py-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div
        className="flex-shrink-0 px-6 py-4"
        style={{ background: "white", borderTop: "1px solid #e2e8f0" }}
      >
        {/* 检索状态指示 */}
        {isStreaming && (
          <div className="flex items-center gap-2 mb-3">
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse"
              style={{ background: "#3b82f6" }}
            />
            <span className="text-xs" style={{ color: "#3b82f6" }}>
              ✨ 正在检索系统数据库并思考...
            </span>
          </div>
        )}

        {/* 非空状态下的快捷提问条 */}
        {!isEmpty && !isStreaming && (
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {QUICK_PROMPTS.slice(0, 4).map((p) => (
              <button
                key={p.label}
                onClick={() => sendMessage(p.text)}
                className="px-2.5 py-1 rounded-full text-xs transition-colors"
                style={{ background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#eff6ff";
                  e.currentTarget.style.color = "#2563eb";
                  e.currentTarget.style.borderColor = "#bfdbfe";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#f1f5f9";
                  e.currentTarget.style.color = "#64748b";
                  e.currentTarget.style.borderColor = "#e2e8f0";
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-3">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入问题，如：2025年Q1专利总数是多少？"
              disabled={isStreaming}
              rows={1}
              className="w-full px-4 py-3 text-sm rounded-2xl border resize-none outline-none transition-colors disabled:opacity-60"
              style={{
                borderColor: "#e2e8f0",
                background: "#f8fafc",
                maxHeight: "120px",
                lineHeight: "1.5",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#3b82f6")}
              onBlur={(e) => (e.target.style.borderColor = "#e2e8f0")}
              onInput={(e) => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 120) + "px";
              }}
            />
          </div>

          {isStreaming ? (
            <button
              onClick={stopStreaming}
              className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all hover:opacity-80"
              style={{ background: "#fee2e2" }}
              title="停止生成"
            >
              <Square size={14} style={{ color: "#dc2626" }} />
            </button>
          ) : (
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim()}
              className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}
              title="发送 (Ctrl+Enter)"
            >
              <Send size={14} className="text-white" />
            </button>
          )}
        </div>

        <p className="text-xs text-slate-400 mt-2 text-center">
          Ctrl+Enter 发送 · 回答均附飞书溯源链接 · 严格防幻觉
        </p>
      </div>
    </div>
  );
}
