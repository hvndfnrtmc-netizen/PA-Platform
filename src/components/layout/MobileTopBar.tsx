"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard/reception":          "政府接待",
  "/dashboard/major-projects":     "重大项目",
  "/dashboard/awards":             "荣誉资质",
  "/dashboard/talent":             "人才福利",
  "/dashboard/odc":                "ODC",
  "/dashboard/tasks":              "对外填报",
  "/dashboard/agreement-tracking": "落地协议",
  "/dashboard/party-transfer":     "党员关系",
  "/dashboard/documents":          "公文生成",
  "/dashboard/copilot":            "智库 chat",
  "/dashboard/assets":             "数据中台",
  "/dashboard/settings":           "超级后台",
  "/dashboard/my-tasks":           "部门数据录入",
};

const NAV_LINKS = [
  { href: "/dashboard/reception",          label: "政府接待" },
  { href: "/dashboard/major-projects",     label: "重大项目" },
  { href: "/dashboard/awards",             label: "荣誉资质" },
  { href: "/dashboard/talent",             label: "人才福利" },
  { href: "/dashboard/odc",               label: "ODC" },
  { href: "/dashboard/tasks",             label: "对外填报" },
  { href: "/dashboard/agreement-tracking", label: "落地协议" },
  { href: "/dashboard/documents",          label: "公文生成" },
  { href: "/dashboard/copilot",            label: "智库 chat" },
  { href: "/dashboard/assets",             label: "数据中台" },
];

export function MobileTopBar() {
  const pathname = usePathname();
  const [open, setOpen]   = useState(false);
  const title = Object.entries(PAGE_TITLES).find(([k]) => pathname.startsWith(k))?.[1] ?? "工作台";

  return (
    <div className="flex md:hidden flex-col flex-shrink-0"
      style={{ background: "#0b1120", borderBottom: "1px solid #1e2d45" }}>

      {/* 顶栏行 */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#2563eb,#06b6d4)" }}>
            <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
              <path d="M6 26V6l10 6 10-6v20l-10-6-10 6z"
                stroke="white" strokeWidth="2.5" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="text-sm font-bold text-white">{title}</span>
        </div>
        <button onClick={() => setOpen(v => !v)}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b", padding: "6px" }}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* 展开导航 */}
      {open && (
        <nav className="px-3 pb-3" style={{ borderTop: "1px solid #1e2d45" }}>
          {NAV_LINKS.map(item => {
            const active = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                className="flex items-center px-3 py-2.5 rounded-xl text-sm font-medium mb-0.5 transition-colors"
                style={{
                  background: active ? "#1e3a5f" : "transparent",
                  color:      active ? "#93c5fd" : "#64748b",
                  textDecoration: "none",
                }}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
