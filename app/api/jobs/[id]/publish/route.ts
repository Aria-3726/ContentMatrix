/**
 * POST /api/jobs/:id/publish
 * Upload processed video to one or more platforms.
 * Job must be in REVIEW_PENDING status.
 *
 * Body: { targets?: ("YOUTUBE"|"TIKTOK")[] }
 *   - Default: ["YOUTUBE"] for backward compatibility
 *   - Each target creates/updates a Publication record
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { uploadToYouTube, generateSRT } from "@/lib/publisher/youtube";
import { uploadToTikTok } from "@/lib/publisher/tiktok";
import type { SubtitleSegment } from "@/lib/db/types";
import path from "path";
import fs from "fs";

const VALID_TARGETS = ["YOUTUBE", "TIKTOK"] as const;
type PublishTarget = (typeof VALID_TARGETS)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    targets?: string[];
  };

  const targets = (body.targets ?? ["YOUTUBE"]).filter((t) =>
    VALID_TARGETS.includes(t as PublishTarget)
  ) as PublishTarget[];

  if (targets.length === 0) {
    return NextResponse.json(
      { error: "No valid publish targets specified" },
      { status: 400 }
    );
  }

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

  // Mark job as publishing
  await prisma.job.update({
    where: { id },
    data: { status: "PUBLISHING", errorMsg: "" },
  });

  // Create/update Publication records for each target
  for (const target of targets) {
    await prisma.publication.upsert({
      where: { jobId_platform: { jobId: id, platform: target } },
      create: { jobId: id, platform: target, status: "UPLOADING" },
      update: { status: "UPLOADING", errorMsg: "" },
    });
  }

  // Run uploads asynchronously
  (async () => {
    const results: Record<string, { success: boolean; error?: string }> = {};

    // Shared data
    const tags: string[] = JSON.parse(job.tags || "[]");
    const langMap: Record<string, string> = { EN: "en", JA: "ja", KO: "ko" };
    const thumbPath = path.join(
      process.cwd(),
      "tmp",
      "thumbnails",
      `${id}.jpg`
    );

    // Generate SRT file from subtitles (shared for YouTube)
    let srtPath: string | undefined;
    const subtitles: SubtitleSegment[] = JSON.parse(job.subtitles || "[]");
    if (subtitles.length > 0) {
      srtPath = path.join(process.cwd(), "tmp", "videos", `${id}.srt`);
      await fs.promises.writeFile(srtPath, generateSRT(subtitles), "utf-8");
    }

    // ── YouTube ───────────────────────────────────────────────
    if (targets.includes("YOUTUBE")) {
      try {
        const ytResult = await uploadToYouTube({
          videoFilePath: videoPath,
          title: job.translatedTitle || job.title,
          description: job.translatedDesc || job.description,
          tags,
          language: langMap[job.targetLanguage] ?? "en",
          categoryId: "20",
          thumbnailPath: fs.existsSync(thumbPath) ? thumbPath : undefined,
          srtPath,
        });

        await prisma.publication.update({
          where: { jobId_platform: { jobId: id, platform: "YOUTUBE" } },
          data: {
            status: "PUBLISHED",
            externalId: ytResult.videoId,
            externalUrl: ytResult.url,
            publishedAt: new Date(),
          },
        });

        // Legacy fields for backward compat
        await prisma.job.update({
          where: { id },
          data: {
            youtubeVideoId: ytResult.videoId,
            youtubeUrl: ytResult.url,
            publishedYoutubeAt: new Date(),
          },
        });

        results.YOUTUBE = { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prisma.publication.update({
          where: { jobId_platform: { jobId: id, platform: "YOUTUBE" } },
          data: { status: "FAILED", errorMsg: msg },
        });
        results.YOUTUBE = { success: false, error: msg };
      }
    }

    // ── TikTok ────────────────────────────────────────────────
    if (targets.includes("TIKTOK")) {
      try {
        const ttResult = await uploadToTikTok({
          videoFilePath: videoPath,
          title: job.translatedTitle || job.title,
          privacyLevel: "SELF_ONLY", // Private first — review before going public
        });

        await prisma.publication.update({
          where: { jobId_platform: { jobId: id, platform: "TIKTOK" } },
          data: {
            status: "PUBLISHED",
            externalId: ttResult.publishId,
            publishedAt: new Date(),
          },
        });

        results.TIKTOK = { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prisma.publication.update({
          where: { jobId_platform: { jobId: id, platform: "TIKTOK" } },
          data: { status: "FAILED", errorMsg: msg },
        });
        results.TIKTOK = { success: false, error: msg };
      }
    }

    // ── Finalize job status ───────────────────────────────────
    const allSuccess = Object.values(results).every((r) => r.success);
    const allFailed = Object.values(results).every((r) => !r.success);
    const errors = Object.entries(results)
      .filter(([, r]) => !r.success)
      .map(([t, r]) => `${t}: ${r.error}`)
      .join("; ");

    await prisma.job.update({
      where: { id },
      data: {
        // Publish fail → back to REVIEW_PENDING so user can retry without re-processing
        status: allFailed ? "REVIEW_PENDING" : "PUBLISHED",
        errorMsg: allSuccess ? "" : errors,
      },
    });
  })();

  return NextResponse.json({
    success: true,
    message: `Publishing to ${targets.join(", ")} started`,
    targets,
  });
}
