"use client";

import { useEffect, useState } from "react";

interface CheckResult {
  ytdlp: boolean;
  ffmpeg: boolean;
  openai: boolean;
  youtube: boolean;
  tiktok: boolean;
}

const ITEM_LABELS: Record<keyof CheckResult, string> = {
  ytdlp: "yt-dlp",
  ffmpeg: "FFmpeg",
  openai: "OpenAI API Key",
  youtube: "YouTube OAuth",
  tiktok: "TikTok",
};

/** Generate PKCE code_verifier + code_challenge using Web Crypto API */
async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const encoded = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return { codeVerifier, codeChallenge };
}

export function SystemStatus() {
  const [status, setStatus] = useState<CheckResult | null>(null);

  useEffect(() => {
    fetch("/api/system-check")
      .then((r) => r.json())
      .then(setStatus);
  }, []);

  async function handleConnectTikTok() {
    const { codeVerifier, codeChallenge } = await generatePKCE();
    // Store verifier in sessionStorage so the callback page can use it
    sessionStorage.setItem("tiktok_cv", codeVerifier);
    window.location.href = `/api/auth/tiktok/start?code_challenge=${encodeURIComponent(codeChallenge)}`;
  }

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
      {!status.tiktok && (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={handleConnectTikTok}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black text-white text-xs rounded-lg hover:bg-gray-800 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/>
            </svg>
            连接 TikTok
          </button>
          <span className="text-xs text-gray-400">授权后才能发布视频到 TikTok</span>
        </div>
      )}
      {status.tiktok && (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={handleConnectTikTok}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            🔄 重新授权 TikTok
          </button>
        </div>
      )}
    </div>
  );
}
