"use client";

import { StatusBadge } from "./StatusBadge";

export interface JobSummary {
  id: string;
  bvid: string;
  title: string;
  thumbnail: string;
  duration: number;
  viewCount: number;
  likeCount: number;
  authorName: string;
  status: string;
  errorMsg: string;
  targetLanguage: string;
  translatedTitle: string;
  youtubeUrl: string;
  createdAt: string;
  sourceUrl: string;
}

interface JobCardProps {
  job: JobSummary;
  onAction: (jobId: string, action: string) => void;
  isLoading?: boolean;
}

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fmtNum(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString();
}

const NEXT_ACTIONS: Record<string, { label: string; action: string; color: string }> = {
  DISCOVERED:   { label: "下载视频", action: "download",   color: "bg-blue-600 hover:bg-blue-700" },
  DOWNLOADED:   { label: "开始转录", action: "transcribe", color: "bg-indigo-600 hover:bg-indigo-700" },
  TRANSCRIBED:  { label: "开始翻译", action: "translate",  color: "bg-amber-600 hover:bg-amber-700" },
  TRANSLATED:   { label: "AI 配音",  action: "dub",        color: "bg-fuchsia-600 hover:bg-fuchsia-700" },
  REVIEW_PENDING: { label: "审核 / 发布", action: "review", color: "bg-green-600 hover:bg-green-700" },
  FAILED:       { label: "重新下载", action: "download",   color: "bg-red-600 hover:bg-red-700" },
};

export function JobCard({ job, onAction, isLoading }: JobCardProps) {
  const nextAction = NEXT_ACTIONS[job.status];
  const isProcessing = [
    "DOWNLOADING", "TRANSCRIBING", "TRANSLATING", "DUBBING", "PUBLISHING"
  ].includes(job.status);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
      {/* Thumbnail */}
      <div className="relative aspect-video bg-gray-100 overflow-hidden">
        {job.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/proxy/image?url=${encodeURIComponent(job.thumbnail)}`}
            alt={job.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-4xl">
            🎮
          </div>
        )}
        <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
          {fmtDuration(job.duration)}
        </span>
      </div>

      <div className="p-3 space-y-2">
        {/* Title */}
        <p className="text-sm font-medium line-clamp-2 leading-snug">
          {job.translatedTitle || job.title}
        </p>
        {job.translatedTitle && job.translatedTitle !== job.title && (
          <p className="text-xs text-gray-400 line-clamp-1">{job.title}</p>
        )}

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>▶ {fmtNum(job.viewCount)}</span>
          <span>👍 {fmtNum(job.likeCount)}</span>
          <span className="truncate">@{job.authorName}</span>
        </div>

        {/* Status */}
        <div className="flex items-center justify-between">
          <StatusBadge status={job.status} />
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            {job.targetLanguage}
          </span>
        </div>

        {/* Error */}
        {job.errorMsg && (
          <p className="text-xs text-red-500 bg-red-50 rounded p-1.5 line-clamp-2">
            {job.errorMsg}
          </p>
        )}

        {/* YouTube link */}
        {job.youtubeUrl && (
          <a
            href={job.youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-red-600 hover:underline flex items-center gap-1"
          >
            ▶ 查看 YouTube 视频
          </a>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {isProcessing ? (
            <div className="flex-1 text-center py-1.5 text-sm text-gray-500 bg-gray-50 rounded-lg">
              处理中…
            </div>
          ) : nextAction ? (
            <button
              onClick={() => onAction(job.id, nextAction.action)}
              disabled={isLoading}
              className={`flex-1 py-1.5 text-sm text-white rounded-lg transition-colors disabled:opacity-50 ${nextAction.color}`}
            >
              {isLoading ? "…" : nextAction.label}
            </button>
          ) : null}

          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
            title="查看原视频"
          >
            B
          </a>
        </div>
      </div>
    </div>
  );
}
