"use client";

import type { JobStatus } from "@/lib/db/types";

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string }
> = {
  DISCOVERED:     { label: "待处理",      color: "bg-gray-100 text-gray-600" },
  DOWNLOADING:    { label: "下载中…",     color: "bg-blue-100 text-blue-700 animate-pulse" },
  DOWNLOADED:     { label: "已下载",      color: "bg-cyan-100 text-cyan-700" },
  TRANSCRIBING:   { label: "转录中…",     color: "bg-indigo-100 text-indigo-700 animate-pulse" },
  TRANSCRIBED:    { label: "已转录",      color: "bg-violet-100 text-violet-700" },
  TRANSLATING:    { label: "翻译中…",     color: "bg-amber-100 text-amber-700 animate-pulse" },
  TRANSLATED:     { label: "已翻译",      color: "bg-yellow-100 text-yellow-700" },
  DUBBING:        { label: "配音中…",     color: "bg-fuchsia-100 text-fuchsia-700 animate-pulse" },
  REVIEW_PENDING: { label: "待审核",      color: "bg-orange-100 text-orange-700" },
  PUBLISHING:     { label: "上传中…",     color: "bg-pink-100 text-pink-700 animate-pulse" },
  PUBLISHED:      { label: "✓ 已发布",   color: "bg-green-100 text-green-700" },
  FAILED:         { label: "✗ 失败",     color: "bg-red-100 text-red-700" },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    color: "bg-gray-100 text-gray-500",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}
    >
      {cfg.label}
    </span>
  );
}
