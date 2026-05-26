"use client";

import type { JobSummary } from "./JobCard";

const STATUS_ORDER = [
  "DISCOVERED",
  "DOWNLOADING",
  "DOWNLOADED",
  "TRANSCRIBING",
  "TRANSCRIBED",
  "TRANSLATING",
  "TRANSLATED",
  "DUBBING",
  "REVIEW_PENDING",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
];

const STATUS_LABELS: Record<string, string> = {
  DISCOVERED: "待处理",
  DOWNLOADING: "下载中",
  DOWNLOADED: "已下载",
  TRANSCRIBING: "转录中",
  TRANSCRIBED: "已转录",
  TRANSLATING: "翻译中",
  TRANSLATED: "已翻译",
  DUBBING: "配音中",
  REVIEW_PENDING: "待审核",
  PUBLISHING: "上传中",
  PUBLISHED: "已发布",
  FAILED: "失败",
};

interface PipelineStatsProps {
  jobs: JobSummary[];
  activeFilter: string | null;
  onFilterChange: (status: string | null) => void;
}

export function PipelineStats({ jobs, activeFilter, onFilterChange }: PipelineStatsProps) {
  const counts: Record<string, number> = {};
  for (const j of jobs) {
    counts[j.status] = (counts[j.status] ?? 0) + 1;
  }

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      <button
        onClick={() => onFilterChange(null)}
        className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
          activeFilter === null
            ? "bg-gray-800 text-white"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
        }`}
      >
        全部 ({jobs.length})
      </button>
      {STATUS_ORDER.map((s) => {
        const count = counts[s] ?? 0;
        const isActive = activeFilter === s;
        const isEmpty = count === 0;
        return (
          <button
            key={s}
            onClick={() => !isEmpty && onFilterChange(s === activeFilter ? null : s)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              isActive
                ? "bg-gray-800 text-white"
                : isEmpty
                  ? "bg-gray-50 text-gray-300 cursor-default"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {STATUS_LABELS[s]} ({count})
          </button>
        );
      })}
    </div>
  );
}
