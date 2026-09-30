"use client";

/**
 * 文件上传组件（支持拖拽和剪贴板粘贴）
 *
 * 特性：
 * - 拖拽上传
 * - 剪贴板粘贴上传
 * - 图片预览
 * - 文件列表管理
 *
 * 文件格式：
 * {
 *   id: string,
 *   name: string,
 *   url: string,
 *   type: string, // "image" | "pdf" | "doc" | "other"
 *   size?: number,
 *   uploadedAt: string,
 * }
 */

import React, { useState, useRef, useEffect } from "react";
import { Upload, X, File, Image as ImageIcon, FileText, Loader2, Eye } from "lucide-react";

// ── 类型定义 ──────────────────────────────────────────────────────────

export interface FileItem {
  id: string;
  name: string;
  url: string;
  type: "image" | "pdf" | "doc" | "other";
  size?: number;
  uploadedAt: string;
}

export interface FileUploaderProps {
  /** 已上传的文件列表 */
  files: FileItem[];
  /** 文件列表变更回调 */
  onChange: (files: FileItem[]) => void;
  /** 是否只读 */
  readOnly?: boolean;
  /** 最大文件数量 */
  maxFiles?: number;
  /** 最大文件大小（MB） */
  maxSize?: number;
  /** 允许的文件类型 */
  accept?: string;
}

// ── 工具函数 ──────────────────────────────────────────────────────────

function getFileType(file: File): FileItem["type"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  if (
    file.type.includes("word") ||
    file.type.includes("document") ||
    file.name.endsWith(".doc") ||
    file.name.endsWith(".docx")
  )
    return "doc";
  return "other";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── 主组件 ────────────────────────────────────────────────────────────

export function FileUploader({
  files,
  onChange,
  readOnly = false,
  maxFiles = 10,
  maxSize = 500, // MB - 支持大文件和资料包
  accept = "*/*",
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // ── 上传文件到服务器 ──────────────────────────────────────────────────

  async function uploadFile(file: File): Promise<FileItem> {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/major-projects/upload", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "上传失败");
    }

    const data = await res.json();
    return {
      id:         data.id,
      name:       data.name,
      url:        data.url,
      type:       data.type,
      size:       data.size,
      uploadedAt: data.uploadedAt,
    };
  }

  // ── 处理文件 ──────────────────────────────────────────────────────────

  async function handleFiles(fileList: FileList | File[]) {
    if (readOnly) return;

    const filesArray = Array.from(fileList);

    // 检查文件数量限制
    if (files.length + filesArray.length > maxFiles) {
      alert(`最多只能上传 ${maxFiles} 个文件`);
      return;
    }

    // 检查文件大小
    const oversized = filesArray.find((f) => f.size > maxSize * 1024 * 1024);
    if (oversized) {
      alert(`文件「${oversized.name}」超过 ${maxSize}MB 大小限制`);
      return;
    }

    setUploading(true);
    try {
      const uploadPromises = filesArray.map((file) => uploadFile(file));
      const newFiles = await Promise.all(uploadPromises);
      onChange([...files, ...newFiles]);
    } catch (err) {
      console.error("上传失败:", err);
      alert("上传失败，请重试");
    } finally {
      setUploading(false);
    }
  }

  // ── 拖拽上传 ──────────────────────────────────────────────────────────

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === dropZoneRef.current) {
      setIsDragging(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (readOnly) return;

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      handleFiles(droppedFiles);
    }
  }

  // ── 剪贴板粘贴 ────────────────────────────────────────────────────────

  useEffect(() => {
    if (readOnly) return;

    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        handleFiles(imageFiles);
      }
    }

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, files]);

  // ── 删除文件 ──────────────────────────────────────────────────────────

  function handleRemove(fileId: string) {
    if (readOnly) return;
    onChange(files.filter((f) => f.id !== fileId));
  }

  // ── 文件图标 ──────────────────────────────────────────────────────────

  function getFileIcon(file: FileItem) {
    switch (file.type) {
      case "image":
        return <ImageIcon size={20} className="text-blue-500" />;
      case "pdf":
        return <FileText size={20} className="text-red-500" />;
      case "doc":
        return <FileText size={20} className="text-blue-600" />;
      default:
        return <File size={20} className="text-gray-500" />;
    }
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* 上传区域 */}
      {!readOnly && files.length < maxFiles && (
        <div
          ref={dropZoneRef}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
            transition-colors
            ${
              isDragging
                ? "border-blue-500 bg-blue-50"
                : "border-gray-300 hover:border-gray-400"
            }
            ${uploading ? "opacity-50 cursor-not-allowed" : ""}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={accept}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
            className="hidden"
            disabled={uploading}
          />

          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={32} className="animate-spin text-blue-600" />
              <p className="text-sm text-gray-600">正在上传...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload size={32} className="text-gray-400" />
              <p className="text-sm text-gray-600">
                点击上传或拖拽文件到此处
              </p>
              <p className="text-xs text-gray-400">
                支持上传大文件与资料包（最大 {maxSize}MB）
              </p>
            </div>
          )}
        </div>
      )}

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              {/* 文件图标 */}
              <div className="flex-shrink-0">{getFileIcon(file)}</div>

              {/* 文件信息 */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {file.name}
                </div>
                {file.size && (
                  <div className="text-xs text-gray-500">
                    {formatFileSize(file.size)}
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-1">
                {/* 预览按钮（仅图片） */}
                {file.type === "image" && (
                  <button
                    onClick={() => setPreviewImage(file.url)}
                    className="p-1 hover:bg-gray-200 rounded"
                    title="预览"
                  >
                    <Eye size={16} className="text-gray-600" />
                  </button>
                )}

                {/* 下载/打开按钮 */}
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 hover:bg-gray-200 rounded"
                  title="打开"
                >
                  <File size={16} className="text-gray-600" />
                </a>

                {/* 删除按钮 */}
                {!readOnly && (
                  <button
                    onClick={() => handleRemove(file.id)}
                    className="p-1 hover:bg-gray-200 rounded"
                    title="删除"
                  >
                    <X size={16} className="text-red-500" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 图片预览弹窗 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black bg-opacity-75 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-4xl max-h-full">
            <img
              src={previewImage}
              alt="预览"
              className="max-w-full max-h-full object-contain rounded-lg"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-2 right-2 p-2 bg-white rounded-full shadow-lg hover:bg-gray-100"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
