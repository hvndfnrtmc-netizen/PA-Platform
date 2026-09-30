"use client";

import React, { useRef, useState, useCallback, DragEvent, ClipboardEvent } from "react";
import { ImageIcon, X, Loader2, UploadCloud } from "lucide-react";

interface Props {
  value:    string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
}

export function ClipboardImageUploader({ value, onChange, disabled }: Props) {
  const fileRef           = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState("");
  const [dragging, setDragging]   = useState(false);

  const uploadFile = useCallback(async (file: File) => {
    if (disabled) return;
    // Guard: base64 must never reach the DB — only URL strings are stored
    if (!file.type.startsWith("image/")) { setError("仅支持图片格式"); return; }
    if (file.size > 10 * 1024 * 1024) { setError(`图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），请压缩至10MB以下`); return; }
    setError("");
    setUploading(true);
    try {
      // 步骤1：向后端请求签名上传URL（仅传元数据，不传文件本身）
      const metaRes = await fetch("/api/reception/upload-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, fileSize: file.size }),
      });

      if (!metaRes.ok) {
        let errorMsg = `获取上传链接失败 (HTTP ${metaRes.status})`;
        try { const d = await metaRes.json() as { error?: string }; if (d.error) errorMsg = d.error; } catch { /* ignore */ }
        setError(errorMsg);
        return;
      }

      const { uploadUrl, publicUrl, contentType } = await metaRes.json() as {
        uploadUrl: string; publicUrl: string; contentType: string;
      };

      // 步骤2：前端直接 PUT 文件到 Supabase（不经过 Vercel，无大小限制）
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType || file.type },
        body: file,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        console.error("直传Supabase失败:", err);
        setError(`上传失败 (HTTP ${uploadRes.status})`);
        return;
      }

      onChange([...value, publicUrl]);
    } catch (e) {
      console.error("上传异常:", e);
      setError(e instanceof Error ? `上传失败: ${e.message}` : "上传失败，请稍后重试");
    } finally {
      setUploading(false);
    }
  }, [disabled, onChange, value]);

  const uploadFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(f => void uploadFile(f));
  }, [uploadFile]);

  // ── 点击上传
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) uploadFiles(e.target.files);
    e.target.value = "";
  }

  // ── 剪贴板粘贴
  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) images.push(file);
      }
    }
    if (images.length > 0) {
      e.preventDefault();
      uploadFiles(images);
    }
  }

  // ── 拖拽
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  }

  function removePhoto(url: string) {
    onChange(value.filter(u => u !== url));
  }

  return (
    <div onPaste={handlePaste} style={{ outline: "none" }} tabIndex={0}>
      {/* 上传区 */}
      <div
        onClick={() => !disabled && !uploading && fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          border:        `2px dashed ${dragging ? "#2563eb" : "#cbd5e1"}`,
          borderRadius:  12,
          padding:       "20px 16px",
          textAlign:     "center",
          cursor:        disabled ? "default" : "pointer",
          background:    dragging ? "rgba(37,99,235,0.04)" : "#fafafa",
          transition:    "border-color 0.15s, background 0.15s",
          userSelect:    "none",
        }}
      >
        {uploading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#2563eb" }}>
            <Loader2 size={18} className="animate-spin" />
            <span style={{ fontSize: 13 }}>上传中…</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <UploadCloud size={28} style={{ color: dragging ? "#2563eb" : "#94a3b8" }} />
            <span style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>
              点击上传 · 拖拽 · 或按 <kbd style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: 4, fontSize: 12, border: "1px solid #e2e8f0" }}>Ctrl+V</kbd> 粘贴图片
            </span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>支持 JPG / PNG / WEBP / GIF，单张最大 10 MB</span>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={handleFileInput}
      />

      {error && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#ef4444" }}>{error}</div>
      )}

      {/* 缩略图 Grid */}
      {value.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8, marginTop: 12 }}>
          {value.map((url, i) => (
            <div key={url} style={{ position: "relative", aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: "#f1f5f9", border: "1px solid #e2e8f0" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`会议照片 ${i + 1}`}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              {/* 全屏预览 */}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ position: "absolute", inset: 0 }}
                onClick={e => e.stopPropagation()}
              />
              {/* 删除按钮 */}
              {!disabled && (
                <button
                  type="button"
                  title="删除"
                  onClick={e => { e.preventDefault(); removePhoto(url); }}
                  style={{
                    position:     "absolute",
                    top:          4,
                    right:        4,
                    width:        20,
                    height:       20,
                    borderRadius: "50%",
                    background:   "rgba(0,0,0,0.55)",
                    border:       "none",
                    cursor:       "pointer",
                    display:      "flex",
                    alignItems:   "center",
                    justifyContent: "center",
                    color:        "white",
                    zIndex:       10,
                  }}
                >
                  <X size={11} />
                </button>
              )}
              {/* 无法加载时的占位 */}
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                <ImageIcon size={24} style={{ color: "#cbd5e1" }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
