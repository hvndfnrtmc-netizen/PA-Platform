"use client";

/**
 * TodoManager v2 — Notion 风格嵌套任务看板
 *
 * 数据结构：TodoCategory[]（存入 Reception.todoList JSON）
 * 拖拽：@dnd-kit（分类 + 任务均可拖拽排序）
 * 跳转：URL / 飞书文档 / 飞书聊天（AppLink）
 */

import React, { useState, useCallback, useRef } from "react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical, Plus, Pencil, Trash2, X, Check, Link,
  ExternalLink, Link2, MessageSquare, CheckSquare, Square,
} from "lucide-react";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type LinkType = "url" | "feishu_doc" | "feishu_chat";

export interface LinkConfig {
  type:   LinkType;
  target: string;
}

export interface TodoTask {
  id:          string;
  content:     string;
  isCompleted: boolean;
  link?:       LinkConfig;
}

export interface TodoCategory {
  id:    string;
  title: string;
  tasks: TodoTask[];
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function genId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

/** 解析旧格式 / 兜底处理，补全缺失的 id */
export function normalizeCategories(raw: unknown): TodoCategory[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (typeof item !== "object" || !item) return [];
    const obj = item as Record<string, unknown>;
    return [{
      id:    typeof obj.id === "string" ? obj.id : genId(),
      title: typeof obj.title === "string" ? obj.title : "未命名分类",
      tasks: Array.isArray(obj.tasks)
        ? obj.tasks.flatMap((t) => {
            if (typeof t !== "object" || !t) return [];
            const task = t as Record<string, unknown>;
            return [{
              id:          typeof task.id === "string" ? task.id : genId(),
              content:     typeof task.content === "string" ? task.content : "",
              isCompleted: typeof task.isCompleted === "boolean" ? task.isCompleted : false,
              ...(task.link && typeof task.link === "object" ? { link: task.link as LinkConfig } : {}),
            }];
          })
        : [],
    }];
  });
}

/** 飞书聊天 AppLink */
function buildActionHref(link: LinkConfig): string {
  if (link.type === "feishu_chat") {
    return `https://applink.feishu.cn/client/chat/open?openId=${encodeURIComponent(link.target)}`;
  }
  return link.target;
}

// ── 链接配置浮层 ──────────────────────────────────────────────────────────────

function LinkPopover({
  current, onSave, onClear, onClose,
}: {
  current?: LinkConfig;
  onSave:  (cfg: LinkConfig) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [type,   setType]   = useState<LinkType>(current?.type ?? "url");
  const [target, setTarget] = useState(current?.target ?? "");

  const LABELS: Record<LinkType, string> = {
    url:         "网址 URL",
    feishu_doc:  "飞书文档",
    feishu_chat: "飞书聊天",
  };
  const PLACEHOLDERS: Record<LinkType, string> = {
    url:         "https://...",
    feishu_doc:  "https://momenta.feishu.cn/...",
    feishu_chat: "飞书用户 openId（ou_xxxxxxxx）",
  };

  return (
    <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 9999, background: "white", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 14, minWidth: 260 }}
      onMouseDown={e => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>配置跳转按钮</span>
        <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", display: "flex", color: "#94a3b8" }}><X size={13} /></button>
      </div>
      <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
        {(["url", "feishu_doc", "feishu_chat"] as LinkType[]).map(t => (
          <button key={t} type="button" onClick={() => setType(t)}
            style={{ flex: 1, padding: "4px 2px", fontSize: 10, borderRadius: 6, border: `1px solid ${type === t ? "#2563eb" : "#e2e8f0"}`, background: type === t ? "rgba(37,99,235,0.08)" : "white", color: type === t ? "#2563eb" : "#64748b", cursor: "pointer", fontWeight: type === t ? 600 : 400 }}>
            {LABELS[t]}
          </button>
        ))}
      </div>
      <input autoFocus value={target} onChange={e => setTarget(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && target.trim()) { onSave({ type, target: target.trim() }); } if (e.key === "Escape") onClose(); }}
        placeholder={PLACEHOLDERS[type]}
        style={{ boxSizing: "border-box", width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", marginBottom: 10 }} />
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" disabled={!target.trim()} onClick={() => target.trim() && onSave({ type, target: target.trim() })}
          style={{ flex: 1, padding: "5px 0", fontSize: 12, fontWeight: 500, color: "white", background: "#2563eb", border: "none", borderRadius: 7, cursor: "pointer", opacity: !target.trim() ? 0.5 : 1 }}>
          保存
        </button>
        {current && (
          <button type="button" onClick={onClear}
            style={{ padding: "5px 10px", fontSize: 12, color: "#ef4444", background: "white", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 7, cursor: "pointer" }}>
            清除
          </button>
        )}
      </div>
    </div>
  );
}

// ── 可拖拽任务行 ──────────────────────────────────────────────────────────────

function SortableTask({
  task, catId, onToggle, onEdit, onDelete, onLinkSave, onLinkClear,
}: {
  task:       TodoTask;
  catId:      string;
  onToggle:   () => void;
  onEdit:     (content: string) => void;
  onDelete:   () => void;
  onLinkSave: (cfg: LinkConfig) => void;
  onLinkClear:() => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const [editMode,    setEditMode]    = useState(false);
  const [editContent, setEditContent] = useState(task.content);
  const [showLink,    setShowLink]    = useState(false);

  const S: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    display: "flex",
    alignItems: "flex-start",
    gap: 5,
    padding: "4px 2px",
    borderRadius: 6,
    position: "relative",
  };

  const hasLink = !!task.link?.target;

  return (
    <div ref={setNodeRef} style={S}
      onMouseEnter={e => { const ic = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-task-icons]"); if (ic) ic.style.opacity = "1"; }}
      onMouseLeave={e => { const ic = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-task-icons]"); if (ic) ic.style.opacity = "0"; }}>

      {/* 拖拽手柄 */}
      <span {...attributes} {...listeners}
        style={{ display: "flex", alignItems: "center", color: "#d1d5db", cursor: "grab", paddingTop: 3, flexShrink: 0 }}>
        <GripVertical size={11} />
      </span>

      {/* 复选框 */}
      <button type="button" onClick={onToggle}
        style={{ border: "none", background: "transparent", cursor: "pointer", padding: "1px 0", display: "flex", alignItems: "center", flexShrink: 0, marginTop: 2 }}>
        {task.isCompleted
          ? <CheckSquare size={14} style={{ color: "#2563eb" }} />
          : <Square size={14} style={{ color: "#cbd5e1" }} />}
      </button>

      {/* 内容 / 就地编辑 */}
      {editMode ? (
        <input autoFocus value={editContent} onChange={e => setEditContent(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); onEdit(editContent); setEditMode(false); }
            if (e.key === "Escape") { setEditMode(false); setEditContent(task.content); }
          }}
          onClick={e => e.stopPropagation()}
          style={{ flex: 1, fontSize: 12, padding: "1px 6px", border: "1px solid #2563eb", borderRadius: 5, outline: "none", boxSizing: "border-box" }} />
      ) : (
        <span style={{ flex: 1, fontSize: 12, color: task.isCompleted ? "#94a3b8" : "#1e293b", textDecoration: task.isCompleted ? "line-through" : "none", lineHeight: 1.5, paddingTop: 2 }}>
          {task.content}
        </span>
      )}

      {/* 已配置跳转按钮（常驻） */}
      {hasLink && (
        <a href={buildActionHref(task.link!)} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ display: "flex", alignItems: "center", padding: "2px 5px", borderRadius: 5, border: "1px solid rgba(37,99,235,0.2)", color: "#2563eb", background: "rgba(37,99,235,0.05)", flexShrink: 0, textDecoration: "none", marginTop: 1 }}>
          {task.link!.type === "feishu_chat" ? <MessageSquare size={10} />
            : task.link!.type === "feishu_doc" ? <Link2 size={10} />
            : <ExternalLink size={10} />}
        </a>
      )}

      {/* Hover 操作区 */}
      <div data-task-icons="" style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, opacity: 0, transition: "opacity 0.12s", position: "relative" }}
        onClick={e => e.stopPropagation()}>
        {editMode ? (
          <>
            <button type="button" onMouseDown={() => { onEdit(editContent); setEditMode(false); }}
              style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#2563eb" }}><Check size={11} /></button>
            <button type="button" onMouseDown={() => { setEditMode(false); setEditContent(task.content); }}
              style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#94a3b8" }}><X size={11} /></button>
          </>
        ) : (
          <>
            <button type="button" title="编辑" onClick={() => { setEditMode(true); setEditContent(task.content); setShowLink(false); }}
              style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#64748b" }}><Pencil size={11} /></button>
            <button type="button" title={hasLink ? "编辑链接" : "添加链接"} onClick={() => setShowLink(s => !s)}
              style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: hasLink ? "#2563eb" : "#94a3b8" }}><Link size={11} /></button>
            <button type="button" title="删除" onClick={onDelete}
              style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#ef4444" }}><Trash2 size={11} /></button>
          </>
        )}

        {showLink && (
          <LinkPopover
            current={task.link}
            onSave={cfg => { onLinkSave(cfg); setShowLink(false); }}
            onClear={() => { onLinkClear(); setShowLink(false); }}
            onClose={() => setShowLink(false)} />
        )}
      </div>
    </div>
  );
}

// ── 可拖拽分类区块 ────────────────────────────────────────────────────────────

function SortableCategory({
  cat, onUpdateTitle, onDelete, onAddTask, onUpdateTask, onDeleteTask,
  onTaskLinkSave, onTaskLinkClear, onTaskToggle, onTasksReorder,
}: {
  cat:             TodoCategory;
  onUpdateTitle:   (title: string) => void;
  onDelete:        () => void;
  onAddTask:       (content: string) => void;
  onUpdateTask:    (taskId: string, content: string) => void;
  onDeleteTask:    (taskId: string) => void;
  onTaskLinkSave:  (taskId: string, cfg: LinkConfig) => void;
  onTaskLinkClear: (taskId: string) => void;
  onTaskToggle:    (taskId: string) => void;
  onTasksReorder:  (tasks: TodoTask[]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id });
  const [editTitle,   setEditTitle]   = useState(false);
  const [titleInput,  setTitleInput]  = useState(cat.title);
  const [newContent,  setNewContent]  = useState("");
  const [showNewTask, setShowNewTask] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleTaskDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = cat.tasks.findIndex(t => t.id === active.id);
    const newIdx = cat.tasks.findIndex(t => t.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onTasksReorder(arrayMove(cat.tasks, oldIdx, newIdx));
  }

  return (
    <div ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, marginBottom: 16, background: isDragging ? "#f8fafc" : "transparent", borderRadius: 8, boxShadow: isDragging ? "0 4px 16px rgba(0,0,0,0.08)" : "none" }}>

      {/* 分类标题行 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}
        onMouseEnter={e => { const ic = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-cat-icons]"); if (ic) ic.style.opacity = "1"; }}
        onMouseLeave={e => { const ic = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-cat-icons]"); if (ic) ic.style.opacity = "0"; }}>

        {/* 分类拖拽手柄 */}
        <span {...attributes} {...listeners} style={{ display: "flex", alignItems: "center", color: "#cbd5e1", cursor: "grab", flexShrink: 0 }}>
          <GripVertical size={14} />
        </span>

        <span style={{ display: "inline-block", width: 3, height: 13, borderRadius: 2, background: "#2563eb", flexShrink: 0 }} />

        {editTitle ? (
          <input autoFocus value={titleInput} onChange={e => setTitleInput(e.target.value)}
            onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") { onUpdateTitle(titleInput.trim() || cat.title); setEditTitle(false); } if (e.key === "Escape") { setEditTitle(false); setTitleInput(cat.title); } }}
            style={{ flex: 1, fontSize: 12, fontWeight: 700, padding: "1px 6px", border: "1px solid #2563eb", borderRadius: 5, outline: "none" }} />
        ) : (
          <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "#374151" }}>{cat.title}</span>
        )}

        {/* 分类操作图标 */}
        <div data-cat-icons="" style={{ display: "flex", alignItems: "center", gap: 2, opacity: 0, transition: "opacity 0.12s" }}>
          <button type="button" title="添加任务" onClick={() => setShowNewTask(true)}
            style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#22c55e" }}><Plus size={13} /></button>
          <button type="button" title="编辑标题" onClick={() => { setEditTitle(true); setTitleInput(cat.title); }}
            style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#64748b" }}><Pencil size={12} /></button>
          <button type="button" title="删除分类" onClick={onDelete}
            style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#ef4444" }}><Trash2 size={12} /></button>
        </div>
      </div>

      {/* 任务列表（可拖拽） */}
      <div style={{ paddingLeft: 10 }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTaskDragEnd}>
          <SortableContext items={cat.tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            {cat.tasks.map(task => (
              <SortableTask
                key={task.id}
                task={task}
                catId={cat.id}
                onToggle={()               => onTaskToggle(task.id)}
                onEdit={content            => onUpdateTask(task.id, content)}
                onDelete={()               => onDeleteTask(task.id)}
                onLinkSave={cfg            => onTaskLinkSave(task.id, cfg)}
                onLinkClear={()            => onTaskLinkClear(task.id)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* 新增任务输入框 */}
        {showNewTask ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <input autoFocus value={newContent} onChange={e => setNewContent(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newContent.trim()) { onAddTask(newContent.trim()); setNewContent(""); setShowNewTask(false); } if (e.key === "Escape") { setShowNewTask(false); setNewContent(""); } }}
              placeholder="输入任务内容，回车确认…"
              style={{ flex: 1, fontSize: 12, padding: "4px 8px", border: "1px solid #2563eb", borderRadius: 6, outline: "none" }} />
            <button type="button" onClick={() => { if (newContent.trim()) { onAddTask(newContent.trim()); setNewContent(""); } setShowNewTask(false); }}
              style={{ fontSize: 11, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 5, padding: "4px 8px", cursor: "pointer" }}>取消</button>
          </div>
        ) : (
          <button type="button" onClick={() => setShowNewTask(true)}
            style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: "none", cursor: "pointer", fontSize: 11, color: "#94a3b8", padding: "3px 0", marginTop: 2 }}>
            <Plus size={11} />新增任务
          </button>
        )}
      </div>
    </div>
  );
}

// ── 主组件 ───────────────────────────────────────────────────────────────────

interface Props {
  value:    TodoCategory[];
  onChange: (cats: TodoCategory[]) => void;
}

export function TodoManager({ value, onChange }: Props) {
  const categories = value;
  const [newCatTitle, setNewCatTitle] = useState("");
  const [showNewCat,  setShowNewCat]  = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Category helpers ───────────────────────────────────────────────────────

  function handleCatDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = categories.findIndex(c => c.id === active.id);
    const newIdx = categories.findIndex(c => c.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onChange(arrayMove(categories, oldIdx, newIdx));
  }

  function updateCat(catId: string, patch: Partial<TodoCategory>) {
    onChange(categories.map(c => c.id === catId ? { ...c, ...patch } : c));
  }

  function addCategory(title: string) {
    if (!title.trim()) return;
    onChange([...categories, { id: genId(), title: title.trim(), tasks: [] }]);
  }

  function deleteCategory(catId: string) {
    if (!window.confirm("确定要删除这个分类及其所有任务吗？")) return;
    onChange(categories.filter(c => c.id !== catId));
  }

  // ── Task helpers ───────────────────────────────────────────────────────────

  function updateTask(catId: string, taskId: string, patch: Partial<TodoTask>) {
    onChange(categories.map(c => c.id !== catId ? c : {
      ...c,
      tasks: c.tasks.map(t => t.id === taskId ? { ...t, ...patch } : t),
    }));
  }

  function addTask(catId: string, content: string) {
    onChange(categories.map(c => c.id !== catId ? c : {
      ...c,
      tasks: [...c.tasks, { id: genId(), content, isCompleted: false }],
    }));
  }

  function deleteTask(catId: string, taskId: string) {
    onChange(categories.map(c => c.id !== catId ? c : {
      ...c, tasks: c.tasks.filter(t => t.id !== taskId),
    }));
  }

  function reorderTasks(catId: string, tasks: TodoTask[]) {
    onChange(categories.map(c => c.id !== catId ? c : { ...c, tasks }));
  }

  // ── 渲染 ─────────────────────────────────────────────────────────────────

  const total     = categories.reduce((s, c) => s + c.tasks.length, 0);
  const completed = categories.reduce((s, c) => s + c.tasks.filter(t => t.isCompleted).length, 0);

  return (
    <div>
      {/* 进度条 */}
      {total > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 4, background: "#f1f5f9", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 4, background: "#2563eb", width: `${total ? Math.round(completed / total * 100) : 0}%`, transition: "width 0.3s" }} />
          </div>
          <span style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>{completed}/{total} 完成</span>
        </div>
      )}

      {/* 分类拖拽列表 */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatDragEnd}>
        <SortableContext items={categories.map(c => c.id)} strategy={verticalListSortingStrategy}>
          {categories.map(cat => (
            <SortableCategory
              key={cat.id}
              cat={cat}
              onUpdateTitle={title        => updateCat(cat.id, { title })}
              onDelete={()                => deleteCategory(cat.id)}
              onAddTask={content          => addTask(cat.id, content)}
              onUpdateTask={(tid, content) => updateTask(cat.id, tid, { content })}
              onDeleteTask={tid            => deleteTask(cat.id, tid)}
              onTaskLinkSave={(tid, cfg)   => updateTask(cat.id, tid, { link: cfg })}
              onTaskLinkClear={tid         => updateTask(cat.id, tid, { link: undefined })}
              onTaskToggle={tid            => updateTask(cat.id, tid, { isCompleted: !cat.tasks.find(t => t.id === tid)?.isCompleted })}
              onTasksReorder={tasks        => reorderTasks(cat.id, tasks)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* 添加分类 */}
      {showNewCat ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          <input autoFocus value={newCatTitle} onChange={e => setNewCatTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && newCatTitle.trim()) { addCategory(newCatTitle); setNewCatTitle(""); setShowNewCat(false); } if (e.key === "Escape") { setShowNewCat(false); setNewCatTitle(""); } }}
            placeholder="输入分类名称，回车确认…"
            style={{ flex: 1, fontSize: 12, padding: "6px 10px", border: "1px solid #2563eb", borderRadius: 8, outline: "none" }} />
          <button type="button" onClick={() => { setShowNewCat(false); setNewCatTitle(""); }}
            style={{ fontSize: 12, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>取消</button>
        </div>
      ) : (
        <button type="button" onClick={() => setShowNewCat(true)}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", border: "1px dashed #cbd5e1", borderRadius: 8, background: "white", fontSize: 12, color: "#64748b", cursor: "pointer", marginTop: 6, width: "100%", justifyContent: "center" }}>
          <Plus size={13} style={{ color: "#22c55e" }} />添加分类
        </button>
      )}
    </div>
  );
}
