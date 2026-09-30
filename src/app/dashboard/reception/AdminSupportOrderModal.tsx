"use client";

/**
 * AdminSupportOrderModal — 行政支持工单派发弹窗
 *
 * 阶段一触发：TodoManagerV2 中，标题含「行政支持」或「admin支持」的任务行显示「派发行政工单」按钮
 * 阶段二：智能表单（会议背景 / 物资选配 / 补充说明）
 * 阶段三：组装 Markdown 字段列表，调用 /api/reception/[id]/notify 发送飞书消息
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  X, Check, ChevronDown, MessageSquare, User, Loader2, Send,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SavedTarget { id: string; name: string; type: string }

export interface AdminReceptionInfo {
  id:        string;
  title:     string;
  startTime: string | null;
  address:   string | null;
}

interface FormValues {
  meetingRoom:     string;
  meetingTime:     string;
  guestCount:      number;
  ourCount:        number;
  // 物资
  tea:             boolean;
  teaQty:          string;
  teaMethod:       string;
  teaReadyTime:    string;
  water:           boolean;
  waterQty:        string;
  waterPlacement:  string;
  stationery:      boolean;
  stationeryQty:   string;
  drinks:          boolean;
  drinksDetail:    string;
  fruitPlate:      boolean;
  fruitPlateQty:   string;
  nameCard:        boolean;
  nameCardQty:     string;
  umbrella:        boolean;
  umbrellaQty:     string;
  notes:           string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDT(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// ── 通知目标多选下拉（与 ReceptionShareDialog 相同交互模式）────────────────────

const MAX_TAGS = 3;

function TargetPicker({
  targets, loading, selected, onToggle, personOnly = false,
}: {
  targets:     SavedTarget[];
  loading:     boolean;
  selected:    Set<string>;
  onToggle:    (id: string) => void;
  personOnly?: boolean;
}) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const { groups, persons } = useMemo(() => {
    const q = search.toLowerCase();
    const list = q ? targets.filter(t => t.name.toLowerCase().includes(q)) : targets;
    const allPersons = list.filter(t => t.type !== "GROUP");
    if (personOnly) return { groups: [], persons: allPersons };
    return { groups: list.filter(t => t.type === "GROUP"), persons: allPersons };
  }, [targets, search, personOnly]);

  const selTargets = targets.filter(t => selected.has(t.id));

  const rowStyle = (sel: boolean, selBg: string): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
    cursor: "pointer", background: sel ? selBg : "white",
  });

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {/* Trigger */}
      <div
        onClick={() => !loading && setOpen(v => !v)}
        style={{
          minHeight: 34, border: `1.5px solid ${open ? "#2563eb" : "#e2e8f0"}`, borderRadius: 8,
          padding: "3px 8px 3px 10px", background: "white", cursor: loading ? "default" : "pointer",
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4,
          boxShadow: open ? "0 0 0 3px rgba(37,99,235,0.1)" : "none",
          transition: "border-color 0.12s, box-shadow 0.12s",
        }}
      >
        {loading ? (
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#94a3b8" }}>
            <Loader2 size={11} className="animate-spin" />加载中…
          </span>
        ) : selTargets.length === 0 ? (
          <span style={{ fontSize: 12, color: "#94a3b8" }}>{personOnly ? "点击选择要 @ 的人员…" : "点击选择通知目标…"}</span>
        ) : (
          <>
            {selTargets.slice(0, MAX_TAGS).map(t => (
              <span key={t.id} style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                padding: "1px 7px 1px 5px", borderRadius: 12, fontSize: 11,
                background: t.type === "GROUP" ? "#eff6ff" : "#f0fdf4",
                color: t.type === "GROUP" ? "#1d4ed8" : "#047857",
                border: `1px solid ${t.type === "GROUP" ? "#bfdbfe" : "#bbf7d0"}`,
                whiteSpace: "nowrap",
              }}>
                {t.type === "GROUP" ? <MessageSquare size={9} /> : <User size={9} />}
                {t.name}
              </span>
            ))}
            {selTargets.length > MAX_TAGS && (
              <span style={{ fontSize: 11, color: "#64748b", padding: "1px 6px", borderRadius: 10, background: "#f1f5f9" }}>
                +{selTargets.length - MAX_TAGS} 个
              </span>
            )}
          </>
        )}
        <div style={{ marginLeft: "auto", color: "#94a3b8", flexShrink: 0, display: "flex", alignItems: "center" }}>
          <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "white", border: "1.5px solid #e2e8f0", borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.14)", zIndex: 10000,
          maxHeight: 220, display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索…"
              style={{ width: "100%", fontSize: 12, padding: "3px 8px", border: "1px solid #e2e8f0", borderRadius: 6, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {targets.length === 0 ? (
              <div style={{ padding: 14, fontSize: 12, color: "#94a3b8", textAlign: "center", fontStyle: "italic" }}>{personOnly ? "暂无可 @ 的个人" : "暂无通知目标"}</div>
            ) : groups.length === 0 && persons.length === 0 ? (
              <div style={{ padding: 10, fontSize: 12, color: "#94a3b8", textAlign: "center" }}>无匹配结果</div>
            ) : (
              <>
                {groups.length > 0 && (
                  <>
                    <div style={{ padding: "5px 12px 2px", fontSize: 10, color: "#94a3b8", fontWeight: 700, letterSpacing: "0.06em" }}>群聊</div>
                    {groups.map(t => {
                      const s = selected.has(t.id);
                      return (
                        <div key={t.id} onClick={() => onToggle(t.id)} style={rowStyle(s, "#eff6ff")}
                          onMouseEnter={e => { if (!s) (e.currentTarget as HTMLDivElement).style.background = "#f8fafc"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = s ? "#eff6ff" : "white"; }}>
                          <div style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, border: s ? "none" : "1.5px solid #cbd5e1", background: s ? "#2563eb" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {s && <Check size={9} style={{ color: "white" }} />}
                          </div>
                          <MessageSquare size={11} style={{ color: s ? "#2563eb" : "#94a3b8", flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: s ? "#1d4ed8" : "#374151", fontWeight: s ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                        </div>
                      );
                    })}
                  </>
                )}
                {persons.length > 0 && (
                  <>
                    <div style={{ padding: "5px 12px 2px", fontSize: 10, color: "#94a3b8", fontWeight: 700, letterSpacing: "0.06em" }}>个人</div>
                    {persons.map(t => {
                      const s = selected.has(t.id);
                      return (
                        <div key={t.id} onClick={() => onToggle(t.id)} style={rowStyle(s, "#f0fdf4")}
                          onMouseEnter={e => { if (!s) (e.currentTarget as HTMLDivElement).style.background = "#f8fafc"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = s ? "#f0fdf4" : "white"; }}>
                          <div style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, border: s ? "none" : "1.5px solid #cbd5e1", background: s ? "#059669" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {s && <Check size={9} style={{ color: "white" }} />}
                          </div>
                          <User size={11} style={{ color: s ? "#059669" : "#94a3b8", flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: s ? "#047857" : "#374151", fontWeight: s ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 物资行组件（checkbox + 展开配置）────────────────────────────────────────

function MaterialRow({ label, checked, onToggle, children }: {
  label:    string;
  checked:  boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderRadius: 8, border: `1.5px solid ${checked ? "#bfdbfe" : "#f1f5f9"}`, background: checked ? "#f8fbff" : "#fafafa", transition: "all 0.15s", overflow: "hidden" }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", cursor: "pointer", userSelect: "none" }}>
        <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, border: checked ? "none" : "1.5px solid #cbd5e1", background: checked ? "#2563eb" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {checked && <Check size={10} style={{ color: "white" }} />}
        </div>
        <span style={{ fontSize: 13, color: checked ? "#1d4ed8" : "#374151", fontWeight: checked ? 600 : 400 }}>{label}</span>
      </div>
      {checked && (
        <div style={{ padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 7 }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

interface Props {
  reception: AdminReceptionInfo;
  onClose:   () => void;
}

export function AdminSupportOrderModal({ reception, onClose }: Props) {
  // ── 通知目标数据源（提升至父级，供两个 picker 共用）
  const [targets,        setTargets]        = useState<SavedTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/feishu-targets?module=reception")
      .then(r => r.json())
      .then((d: { targets?: Array<{ id: string; feishuId: string; name: string; type: string }> }) => {
        setTargets((d.targets ?? []).map(t => ({ id: t.feishuId, name: t.name, type: t.type })));
      })
      .catch(() => setTargets([]))
      .finally(() => setTargetsLoading(false));
  }, []);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mentionIds,  setMentionIds]  = useState<Set<string>>(new Set());
  const [sending,     setSending]     = useState(false);
  const [toast,       setToast]       = useState<{ ok: boolean; msg: string } | null>(null);

  // 是否有群聊目标被选中（决定是否显示 @ 提醒选择区）
  const hasGroupTarget = targets.some(t => t.type === "GROUP" && selectedIds.has(t.id));

  const { register, handleSubmit, control, setValue } = useForm<FormValues>({
    defaultValues: {
      meetingRoom:     reception.address ?? "",
      meetingTime:     fmtDT(reception.startTime),
      guestCount:      0,
      ourCount:        0,
      tea:             false, teaQty: "0", teaMethod: "我们自己倒", teaReadyTime: "",
      water:           false, waterQty: "0", waterPlacement: "按人摆放桌上",
      stationery:      false, stationeryQty: "0",
      drinks:          false, drinksDetail: "",
      fruitPlate:      false, fruitPlateQty: "0",
      nameCard:        false, nameCardQty: "0",
      umbrella:        false, umbrellaQty: "0",
      notes: "",
    },
  });

  // 监听人数变化，自动更新默认份数
  const [tea, water, stationery, drinks, fruitPlate, nameCard, umbrella, guestCount, ourCount] = useWatch({
    control,
    name: ["tea", "water", "stationery", "drinks", "fruitPlate", "nameCard", "umbrella", "guestCount", "ourCount"],
  }) as [boolean, boolean, boolean, boolean, boolean, boolean, boolean, number, number];

  const totalCount = (Number(guestCount) || 0) + (Number(ourCount) || 0);

  useEffect(() => {
    setValue("teaQty",        String(totalCount || 0));
    setValue("waterQty",      String(totalCount || 0));
    setValue("stationeryQty", String(Number(guestCount) || 0));
    setValue("nameCardQty",   String(totalCount || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestCount, ourCount]);

  function toggleTarget(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleMention(id: string) {
    setMentionIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function onSubmit(data: FormValues) {
    if (selectedIds.size === 0) { setToast({ ok: false, msg: "请至少选择一个通知目标" }); return; }
    setSending(true); setToast(null);

    // 组装飞书 Markdown 字段（📅 会议时间已放入卡片标题，此处不再单独列出）
    const fields: Array<{ label: string; value: string }> = [
      { label: "📍 会议地点", value: data.meetingRoom || "（未设置）" },
      { label: "👥 参会人数", value: `共 ${totalCount} 人（对方 ${Number(data.guestCount) || 0}，己方 ${Number(data.ourCount) || 0}）` },
    ];

    const materials: string[] = [];
    if (data.tea)        materials.push(`**热茶**：${data.teaQty} 杯${data.teaReadyTime ? `（需在 ${data.teaReadyTime} 前准备好，` : "（"}**${data.teaMethod}**）`);
    if (data.water)      materials.push(`**矿泉水**：${data.waterQty} 瓶（${data.waterPlacement}）`);
    if (data.stationery) materials.push(`**三件套**：${data.stationeryQty} 份`);
    if (data.drinks)     materials.push(`**饮品**：${data.drinksDetail || "（未填写）"}`);
    if (data.fruitPlate) materials.push(`**果盘**：${data.fruitPlateQty || "（未填写）"}`);
    if (data.nameCard)   materials.push(`**席卡壳子**：${data.nameCardQty} 个`);
    if (data.umbrella)   materials.push(`**展厅雨伞**：${data.umbrellaQty} 把`);
    if (materials.length > 0)
      fields.push({ label: "📦 物资支持明细", value: materials.map(m => `- ${m}`).join("\n") });
    if (data.notes.trim())
      fields.push({ label: "📝 补充说明", value: data.notes.trim() });

    try {
      const res = await fetch(`/api/reception/${reception.id}/admin-order-notify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, targetIds: [...selectedIds], mentionIds: [...mentionIds], meetingTime: data.meetingTime }),
      });
      const d = await res.json() as { sent?: number; failed?: number; error?: string };
      if (!res.ok) { setToast({ ok: false, msg: d.error ?? "发送失败" }); return; }
      setToast({ ok: true, msg: "工单已派发 ✓" });
      setTimeout(() => onClose(), 1500);
    } catch {
      setToast({ ok: false, msg: "网络错误，请重试" });
    } finally {
      setSending(false);
    }
  }

  // 通用样式
  const iS: React.CSSProperties = { width: "100%", fontSize: 12, padding: "5px 9px", border: "1px solid #e2e8f0", borderRadius: 7, outline: "none", boxSizing: "border-box", color: "#1e293b", background: "white" };
  const labelS: React.CSSProperties = { fontSize: 11, color: "#64748b", display: "block", marginBottom: 2 };
  const selectS: React.CSSProperties = { ...iS, cursor: "pointer" };
  const subRow: React.CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start" };

  function sectionHead(icon: string, title: string) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #f1f5f9" }}>
        <span style={{ fontSize: 13 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>{title}</span>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 480, maxHeight: "90vh", boxShadow: "0 24px 60px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ background: "linear-gradient(135deg,#0f172a,#1e3a5f)", padding: "15px 20px 12px", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>
            🛎️
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>派发行政工单</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>{reception.title}</div>
          </div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "rgba(255,255,255,0.1)", borderRadius: 7, cursor: "pointer", color: "rgba(255,255,255,0.7)", padding: "4px 6px", display: "flex" }}>
            <X size={14} />
          </button>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit(onSubmit)} style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          <div style={{ overflowY: "auto", flex: 1, padding: "14px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

            {/* 区块 0：通知目标 */}
            <div>
              {sectionHead("📨", `通知目标${selectedIds.size > 0 ? `（已选 ${selectedIds.size}）` : ""}`)}
              <TargetPicker targets={targets} loading={targetsLoading} selected={selectedIds} onToggle={toggleTarget} />
            </div>

            {/* 群内 @ 提醒（仅当已选群聊目标时显示）*/}
            {hasGroupTarget && (
              <div>
                {sectionHead("🔔", `群内 @ 提醒${mentionIds.size > 0 ? `（已选 ${mentionIds.size} 人）` : "（可选）"}`)}
                <div style={{ marginBottom: 6, fontSize: 11, color: "#94a3b8" }}>
                  发至群聊时，选中的成员将在消息中收到强提醒
                </div>
                <TargetPicker targets={targets} loading={targetsLoading} selected={mentionIds} onToggle={toggleMention} personOnly={true} />
              </div>
            )}

            {/* 区块一：会议背景 */}
            <div>
              {sectionHead("📋", "会议背景")}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={labelS}>会议室 / 地点</label>
                  <input {...register("meetingRoom")} style={iS} placeholder="如：302 会议室" />
                </div>
                <div>
                  <label style={labelS}>会议时间</label>
                  <input {...register("meetingTime")} style={iS} placeholder="如：2024-07-22 16:00" />
                </div>
                <div>
                  <label style={labelS}>对方人数</label>
                  <input type="number" min={0} {...register("guestCount", { valueAsNumber: true })} style={iS} />
                </div>
                <div>
                  <label style={labelS}>己方人数</label>
                  <input type="number" min={0} {...register("ourCount", { valueAsNumber: true })} style={iS} />
                </div>
              </div>
              {totalCount > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#2563eb", background: "#eff6ff", borderRadius: 6, padding: "4px 10px", display: "inline-block" }}>
                  总人数：{totalCount} 人
                </div>
              )}
            </div>

            {/* 区块二：物资选配 */}
            <div>
              {sectionHead("📦", "物资选配")}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>

                {/* 热茶 */}
                <MaterialRow label="热茶" checked={!!tea} onToggle={() => setValue("tea", !tea)}>
                  <div style={subRow}>
                    <div style={{ flex: 1 }}>
                      <label style={labelS}>份数</label>
                      <input type="number" min={0} {...register("teaQty")} style={iS} />
                    </div>
                    <div style={{ flex: 2 }}>
                      <label style={labelS}>方式</label>
                      <select {...register("teaMethod")} style={selectS}>
                        <option>我们自己倒</option>
                        <option>阿姨提前泡好</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={labelS}>X 点 X 分前准备好（选填）</label>
                    <input {...register("teaReadyTime")} style={iS} placeholder="如：15:30" />
                  </div>
                </MaterialRow>

                {/* 矿泉水 */}
                <MaterialRow label="矿泉水" checked={!!water} onToggle={() => setValue("water", !water)}>
                  <div style={subRow}>
                    <div style={{ flex: 1 }}>
                      <label style={labelS}>份数</label>
                      <input type="number" min={0} {...register("waterQty")} style={iS} />
                    </div>
                    <div style={{ flex: 2 }}>
                      <label style={labelS}>摆放方式</label>
                      <select {...register("waterPlacement")} style={selectS}>
                        <option>按人摆放桌上</option>
                        <option>墙角预留一箱开箱的</option>
                        <option>按人摆放桌上，并在墙角预留一箱开箱的</option>
                      </select>
                    </div>
                  </div>
                </MaterialRow>

                {/* 三件套 */}
                <MaterialRow label="三件套" checked={!!stationery} onToggle={() => setValue("stationery", !stationery)}>
                  <div>
                    <label style={labelS}>份数（默认对方人数）</label>
                    <input type="number" min={0} {...register("stationeryQty")} style={iS} />
                  </div>
                </MaterialRow>

                {/* 饮品 */}
                <MaterialRow label="饮品" checked={!!drinks} onToggle={() => setValue("drinks", !drinks)}>
                  <div>
                    <label style={labelS}>具体种类与份数</label>
                    <input {...register("drinksDetail")} style={iS} placeholder="如：可乐×2，橙汁×3" />
                  </div>
                </MaterialRow>

                {/* 果盘 */}
                <MaterialRow label="果盘" checked={!!fruitPlate} onToggle={() => setValue("fruitPlate", !fruitPlate)}>
                  <div>
                    <label style={labelS}>具体种类与份数 (如：西瓜1盘，拼盘2份)</label>
                    <input {...register("fruitPlateQty")} style={iS} placeholder="如：西瓜1盘，拼盘2份" />
                  </div>
                </MaterialRow>

                {/* 席卡壳子 */}
                <MaterialRow label="席卡壳子" checked={!!nameCard} onToggle={() => setValue("nameCard", !nameCard)}>
                  <div>
                    <label style={labelS}>个数（默认总人数）</label>
                    <input type="number" min={0} {...register("nameCardQty")} style={iS} />
                  </div>
                </MaterialRow>

                {/* 展厅雨伞 */}
                <MaterialRow label="展厅雨伞" checked={!!umbrella} onToggle={() => setValue("umbrella", !umbrella)}>
                  <div>
                    <label style={labelS}>把数</label>
                    <input type="number" min={0} {...register("umbrellaQty")} style={iS} />
                  </div>
                </MaterialRow>

              </div>
            </div>

            {/* 区块三：补充说明 */}
            <div>
              {sectionHead("📝", "补充注意事项")}
              <textarea {...register("notes")} rows={3} placeholder="特殊嘱咐、注意事项（选填）…"
                style={{ ...iS, resize: "none", lineHeight: 1.6 }} />
            </div>

          </div>

          {/* Toast */}
          {toast && (
            <div style={{ margin: "0 20px 4px", padding: "6px 12px", borderRadius: 8, background: toast.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${toast.ok ? "#bbf7d0" : "#fecaca"}`, fontSize: 12, color: toast.ok ? "#16a34a" : "#dc2626", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {toast.ok ? <Check size={12} /> : <X size={12} />}
              {toast.msg}
            </div>
          )}

          {/* Footer */}
          <div style={{ padding: "10px 20px", borderTop: "1px solid #f1f5f9", display: "flex", gap: 8, justifyContent: "flex-end", flexShrink: 0 }}>
            <button type="button" onClick={onClose} style={{ padding: "7px 16px", borderRadius: 9, border: "1px solid #e2e8f0", background: "white", fontSize: 13, color: "#64748b", cursor: "pointer" }}>取消</button>
            <button type="submit" disabled={sending}
              style={{ padding: "7px 20px", borderRadius: 9, border: "none", fontSize: 13, fontWeight: 600, color: "white", display: "flex", alignItems: "center", gap: 6, cursor: sending ? "not-allowed" : "pointer", background: sending ? "#93c5fd" : "linear-gradient(135deg,#2563eb,#1d4ed8)" }}>
              {sending ? <><Loader2 size={13} className="animate-spin" />派发中…</> : <><Send size={13} />派发工单</>}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
