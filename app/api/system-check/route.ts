/**
 * GET /api/system-check
 * Check whether required tools (yt-dlp, ffmpeg) and API keys are configured.
 */

import { NextResponse } from "next/server";
import { checkYtDlp, checkFfmpeg } from "@/lib/processor/downloader";

export async function GET() {
  const [ytdlp, ffmpeg] = await Promise.all([checkYtDlp(), checkFfmpeg()]);

  return NextResponse.json({
    ytdlp,
    ffmpeg,
    openai: !!process.env.SILICONFLOW_API_KEY,
    youtube: !!(
      process.env.YOUTUBE_CLIENT_ID &&
      process.env.YOUTUBE_CLIENT_SECRET &&
      process.env.YOUTUBE_REFRESH_TOKEN
    ),
    tiktok: !!process.env.TIKTOK_ACCESS_TOKEN,
  });
}
