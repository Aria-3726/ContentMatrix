/**
 * POST /api/jobs/:id/dub
 * Generate AI English voiceover (Microsoft Edge TTS) and replace original Chinese audio.
 * Job must be in TRANSLATED status.
 * Updates job status: DUBBING → REVIEW_PENDING
 *
 * Uses translated subtitle text as narration (not description), so the
 * dubbed audio matches the subtitle content. Word-level timestamps from
 * Edge TTS are mapped back to subtitle segments for accurate timing.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { dubVideo } from "@/lib/processor/dubbing";
import type { SubtitleSegment } from "@/lib/db/types";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (job.status !== "TRANSLATED") {
    return NextResponse.json(
      { error: `Must be TRANSLATED to dub. Current: ${job.status}` },
      { status: 409 }
    );
  }

  if (!job.localVideoPath) {
    return NextResponse.json(
      { error: "No local video path set" },
      { status: 409 }
    );
  }

  // Parse translated subtitles — these are the actual speech content
  const subtitles: SubtitleSegment[] = JSON.parse(job.subtitles || "[]");

  // Build narration text from subtitle segments (actual speech),
  // falling back to translated description or transcript
  const narrationText = subtitles.length > 0
    ? subtitles.map((s) => s.text).join(" ")
    : job.translatedDesc || job.transcript || "";

  if (!narrationText) {
    return NextResponse.json(
      { error: "No translated text available for dubbing" },
      { status: 409 }
    );
  }

  await prisma.job.update({
    where: { id },
    data: { status: "DUBBING", errorMsg: "" },
  });

  (async () => {
    try {
      const result = await dubVideo(
        job.localVideoPath,
        narrationText,
        id,
        subtitles.length > 0 ? subtitles : undefined
      );

      // Save dubbed video path AND updated subtitle timestamps
      const updateData: Record<string, unknown> = {
        status: "REVIEW_PENDING",
        processedVideoPath: result.dubbedVideoPath,
      };

      // If edge-tts returned accurate subtitle timing, save it
      if (result.subtitles && result.subtitles.length > 0) {
        updateData.subtitles = JSON.stringify(result.subtitles);
      }

      await prisma.job.update({ where: { id }, data: updateData });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.job.update({
        where: { id },
        data: { status: "FAILED", errorMsg: msg },
      });
    }
  })();

  return NextResponse.json({ success: true, message: "Dubbing started" });
}
