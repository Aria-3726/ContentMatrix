/**
 * POST /api/jobs/:id/publish
 * Upload processed video to YouTube (private).
 * Job must be in REVIEW_PENDING status.
 * Updates job status: PUBLISHING → PUBLISHED
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { uploadToYouTube, generateSRT } from "@/lib/publisher/youtube";
import type { SubtitleSegment } from "@/lib/db/types";
import path from "path";
import fs from "fs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (job.status !== "REVIEW_PENDING") {
    return NextResponse.json(
      { error: `Must be REVIEW_PENDING to publish. Current: ${job.status}` },
      { status: 409 }
    );
  }

  const videoPath = job.processedVideoPath || job.localVideoPath;
  if (!videoPath) {
    return NextResponse.json(
      { error: "No video file available for publishing" },
      { status: 409 }
    );
  }

  await prisma.job.update({
    where: { id },
    data: { status: "PUBLISHING", errorMsg: "" },
  });

  (async () => {
    try {
      const tags: string[] = JSON.parse(job.tags || "[]");
      const langMap: Record<string, string> = { EN: "en", JA: "ja", KO: "ko" };

      const thumbPath = path.join(process.cwd(), "tmp", "thumbnails", `${id}.jpg`);

      // Generate SRT file from subtitles
      let srtPath: string | undefined;
      const subtitles: SubtitleSegment[] = JSON.parse(job.subtitles || "[]");
      if (subtitles.length > 0) {
        srtPath = path.join(process.cwd(), "tmp", "videos", `${id}.srt`);
        await fs.promises.writeFile(srtPath, generateSRT(subtitles), "utf-8");
      }

      const result = await uploadToYouTube({
        videoFilePath: videoPath,
        title: job.translatedTitle || job.title,
        description: job.translatedDesc || job.description,
        tags,
        language: langMap[job.targetLanguage] ?? "en",
        categoryId: "20", // Gaming
        thumbnailPath: fs.existsSync(thumbPath) ? thumbPath : undefined,
        srtPath,
      });

      await prisma.job.update({
        where: { id },
        data: {
          status: "PUBLISHED",
          youtubeVideoId: result.videoId,
          youtubeUrl: result.url,
          publishedYoutubeAt: new Date(),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.job.update({
        where: { id },
        data: { status: "FAILED", errorMsg: msg },
      });
    }
  })();

  return NextResponse.json({ success: true, message: "Publishing started" });
}
