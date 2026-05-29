"use client";

import { StatusBadge } from "./StatusBadge";

export interface JobSummary {
  id: string;
  platform: string;
  sourceId: string;
  sourceType: string;
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
  localVideoPath: string;
  processedVideoPath: string;
  transcript: string;
  subtitles: string;
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
  DISCOVERED:     { label: "下载",       action: "download",   color: "bg-blue-600 hover:bg-blue-700" },
  DOWNLOADED:     { label: "开始转录",   action: "transcribe", color: "bg-indigo-600 hover:bg-indigo-700" },
  TRANSCRIBED:    { label: "开始翻译",   action: "translate",  color: "bg-amber-600 hover:bg-amber-700" },
  TRANSLATED:     { label: "AI 配音",    action: "dub",        color: "bg-fuchsia-600 hover:bg-fuchsia-700" },
  REVIEW_PENDING: { label: "审核 / 发布", action: "review",    color: "bg-green-600 hover:bg-green-700" },
  // FAILED is handled dynamically below
};

/** Determine the best retry action for a FAILED job based on what artifacts exist. */
function getFailedAction(job: JobSummary): { label: string; action: string; color: string } {
  const color = "bg-red-600 hover:bg-red-700";

  // Has processed video → go straight to review/publish
  if (job.processedVideoPath) {
    return { label: "重新审核发布", action: "review", color: "bg-green-600 hover:bg-green-700" };
  }
  // Has subtitles → retry dubbing
  const subs = job.subtitles && job.subtitles !== "[]";
  if (subs) {
    return { label: "重新配音", action: "dub", color: "bg-fuchsia-600 hover:bg-fuchsia-700" };
  }
  // Has transcript → retry translation
  if (job.transcript) {
    return { label: "重新翻译", action: "translate", color: "bg-amber-600 hover:bg-amber-700" };
  }
  // Has video file → retry transcription
  if (job.localVideoPath) {
    return { label: "重新转录", action: "transcribe", color: "bg-indigo-600 hover:bg-indigo-700" };
  }
  // Nothing — restart from download
  return { label: "重新下载", action: "download", color };
}

export function JobCard({ job, onAction, isLoading }: JobCardProps) {
  const nextAction = job.status === "FAILED"
    ? getFailedAction(job)
    : NEXT_ACTIONS[job.status];
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
            onError={(e) => {
              // Fallback to emoji on load failure
              const target = e.target as HTMLImageElement;
              target.style.display = "none";
              target.parentElement!.classList.add("flex", "items-center", "justify-center");
              const span = document.createElement("span");
              span.className = "text-gray-400 text-4xl";
              span.textContent = job.platform === "XIAOHONGSHU" ? "📕" : "🎮";
              target.parentElement!.appendChild(span);
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-4xl">
            {job.platform === "XIAOHONGSHU" ? "📕" : "🎮"}
          </div>
        )}
        {job.duration > 0 && (
          <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
            {fmtDuration(job.duration)}
          </span>
        )}
        {job.sourceType === "IMAGE_NOTE" && (
          <span className="absolute top-1 left-1 bg-pink-500/80 text-white text-xs px-1.5 py-0.5 rounded">
            图文
          </span>
        )}
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
          {job.viewCount > 0 && <span>▶ {fmtNum(job.viewCount)}</span>}
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
            title={`查看原视频 (${job.platform})`}
          >
            {job.platform === "BILIBILI" ? "B" : job.platform === "DOUYIN" ? "D" : job.platform === "XIAOHONGSHU" ? "X" : "🔗"}
          </a>
        </div>
      </div>
    </div>
  );
}
