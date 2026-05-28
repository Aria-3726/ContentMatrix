/**
 * Video downloader using yt-dlp.
 * yt-dlp supports Bilibili, Douyin, and many other platforms.
 * Install: pip install yt-dlp
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";

const execFileAsync = promisify(execFile);

/** Map platform → { env var name, cookie domain } */
const PLATFORM_COOKIES: Record<string, { envKey: string; domain: string }> = {
  BILIBILI:    { envKey: "BILIBILI_COOKIE",    domain: ".bilibili.com" },
  DOUYIN:      { envKey: "DOUYIN_COOKIE",      domain: ".douyin.com" },
  XIAOHONGSHU: { envKey: "XIAOHONGSHU_COOKIE", domain: ".xiaohongshu.com" },
};

function getCookiesFile(platform?: string): string | null {
  const cfg = PLATFORM_COOKIES[platform ?? "BILIBILI"];
  if (!cfg) return null;

  const cookieStr = process.env[cfg.envKey];
  if (!cookieStr) return null;

  const pairs = cookieStr.split(";").map((s) => s.trim()).filter(Boolean);
  const lines = ["# Netscape HTTP Cookie File"];
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    lines.push(`${cfg.domain}\tTRUE\t/\tFALSE\t9999999999\t${name}\t${value}`);
  }
  const tmpFile = path.join(os.tmpdir(), `contentmatrix-${(platform ?? "bilibili").toLowerCase()}-cookies.txt`);
  fs.writeFileSync(tmpFile, lines.join("\n") + "\n", "utf-8");
  return tmpFile;
}

// Store downloads in /tmp/contentmatrix-videos (or override via env)
export const DOWNLOAD_DIR =
  process.env.VIDEO_DOWNLOAD_DIR ??
  path.join(process.cwd(), "tmp", "videos");

export async function ensureDownloadDir(): Promise<void> {
  await fs.promises.mkdir(DOWNLOAD_DIR, { recursive: true });
}

export interface DownloadResult {
  filePath: string;
  filename: string;
}

/**
 * Download a video from any yt-dlp-supported URL.
 * Returns the local file path.
 */
export async function downloadVideo(
  url: string,
  jobId: string,
  platform?: string
): Promise<DownloadResult> {
  await ensureDownloadDir();

  const outputTemplate = path.join(DOWNLOAD_DIR, `${jobId}.%(ext)s`);

  const args = [
    url,
    "--output", outputTemplate,
    "--format", "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
    "--merge-output-format", "mp4",
    "--no-playlist",
    "--no-warnings",
    "--quiet",
    "--progress",
  ];

  const cookiesFile = getCookiesFile(platform);
  if (cookiesFile) {
    args.push("--cookies", cookiesFile);
  }

  try {
    await execFileAsync("yt-dlp", args, {
      timeout: 10 * 60 * 1000,
      env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? "/usr/bin:/bin"}` },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`yt-dlp failed: ${msg}`);
  }

  // Find the resulting file
  const files = await fs.promises.readdir(DOWNLOAD_DIR);
  const match = files.find((f) => f.startsWith(jobId));
  if (!match) {
    throw new Error("Download completed but output file not found");
  }

  return {
    filePath: path.join(DOWNLOAD_DIR, match),
    filename: match,
  };
}

/**
 * Extract audio-only from a downloaded video (for Whisper transcription).
 * Returns path to the extracted audio file.
 */
export async function extractAudio(
  videoPath: string,
  jobId: string
): Promise<string> {
  const audioPath = path.join(DOWNLOAD_DIR, `${jobId}_audio.mp3`);

  const { execFile: execFileSync } = await import("child_process");
  const exec = promisify(execFileSync);

  await exec("ffmpeg", [
    "-i", videoPath,
    "-vn",
    "-ar", "16000",
    "-ac", "1",
    "-q:a", "0",
    "-y",
    audioPath,
  ], {
    env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? "/usr/bin:/bin"}` },
  });

  return audioPath;
}

/** Check if yt-dlp is installed */
export async function checkYtDlp(): Promise<boolean> {
  try {
    await execFileAsync("yt-dlp", ["--version"], {
      env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? "/usr/bin:/bin"}` },
    });
    return true;
  } catch {
    return false;
  }
}

/** Check if ffmpeg is installed */
export async function checkFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"], {
      env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? "/usr/bin:/bin"}` },
    });
    return true;
  } catch {
    return false;
  }
}
