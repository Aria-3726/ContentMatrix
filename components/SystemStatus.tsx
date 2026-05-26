"use client";

import { useEffect, useState } from "react";

interface CheckResult {
  ytdlp: boolean;
  ffmpeg: boolean;
  openai: boolean;
  youtube: boolean;
}

const ITEM_LABELS: Record<keyof CheckResult, string> = {
  ytdlp: "yt-dlp",
  ffmpeg: "FFmpeg",
  openai: "OpenAI API Key",
  youtube: "YouTube OAuth",
};

export function SystemStatus() {
  const [status, setStatus] = useState<CheckResult | null>(null);

  useEffect(() => {
    fetch("/api/system-check")
      .then((r) => r.json())
      .then(setStatus);
  }, []);

  if (!status) return null;

  const allOk = Object.values(status).every(Boolean);

  return (
    <div
      className={`rounded-lg border p-3 text-sm mb-4 ${
        allOk
          ? "border-green-200 bg-green-50"
          : "border-amber-200 bg-amber-50"
      }`}
    >
      <p className="font-semibold mb-2">
        {allOk ? "✅ 系统环境就绪" : "⚠️ 环境检查"}
      </p>
      <div className="flex flex-wrap gap-3">
        {(Object.keys(ITEM_LABELS) as (keyof CheckResult)[]).map((k) => (
          <span
            key={k}
            className={`flex items-center gap-1 ${
              status[k] ? "text-green-700" : "text-red-600"
            }`}
          >
            {status[k] ? "✓" : "✗"} {ITEM_LABELS[k]}
          </span>
        ))}
      </div>
      {!status.ytdlp && (
        <p className="mt-2 text-xs text-gray-500">
          安装 yt-dlp：<code className="bg-white px-1 rounded">pip install yt-dlp</code>
        </p>
      )}
      {!status.ffmpeg && (
        <p className="mt-1 text-xs text-gray-500">
          安装 FFmpeg：<code className="bg-white px-1 rounded">apt install ffmpeg</code> 或从 ffmpeg.org 下载
        </p>
      )}
      {!status.openai && (
        <p className="mt-1 text-xs text-gray-500">
          在 .env 中设置 <code className="bg-white px-1 rounded">OPENAI_API_KEY</code>
        </p>
      )}
      {!status.youtube && (
        <p className="mt-1 text-xs text-gray-500">
          在 .env 中设置 YouTube OAuth 三个环境变量（见 README）
        </p>
      )}
    </div>
  );
}
