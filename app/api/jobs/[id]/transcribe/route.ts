/**
 * POST /api/jobs/:id/transcribe
 * Run Whisper transcription on a downloaded video.
 * Updates job status: TRANSCRIBING → TRANSCRIBED
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { transcribeFile } from "@/lib/processor/transcriber";
import { extractAudio } from "@/lib/processor/downloader";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!["DOWNLOADED", "FAILED"].includes(job.status)) {
    return NextResponse.json(
      { error: `Must be DOWNLOADED to transcribe. Current: ${job.status}` },
      { status: 409 }
    );
  }

  // For FAILED VIDEO jobs, localVideoPath must still be set (re-download if not)
  if (job.sourceType !== "IMAGE_NOTE" && !job.localVideoPath) {
    return NextResponse.json(
      { error: "No local video file — please re-download first" },
      { status: 409 }
    );
  }

  if (!job.localVideoPath) {
    return NextResponse.json(
      { error: "No local video path set" },
      { status: 409 }
    );
  }

  await prisma.job.update({
    where: { id },
    data: { status: "TRANSCRIBING", errorMsg: "" },
  });

  (async () => {
    try {
      // IMAGE_NOTE has no audio — skip extraction and store empty transcript
      if (job.sourceType === "IMAGE_NOTE") {
        await prisma.job.update({
          where: { id },
          data: { status: "TRANSCRIBED", transcript: "", subtitles: "[]" },
        });
        return;
      }

      const audioPath = await extractAudio(job.localVideoPath, id);
      const result = await transcribeFile(audioPath, "zh");

      // Estimate segment timestamps proportionally across the video duration
      const totalChars = result.segments.reduce((sum, s) => sum + s.text.length, 0);
      const videoDuration = job.duration || 60; // fallback 60s
      let cursor = 0;
      const segments = result.segments.map((s) => {
        const ratio = totalChars > 0 ? s.text.length / totalChars : 1 / result.segments.length;
        const segDuration = videoDuration * ratio;
        const start = Math.round(cursor * 100) / 100;
        const end = Math.round((cursor + segDuration) * 100) / 100;
        cursor += segDuration;
        return { start, end, text: s.text };
      });

      await prisma.job.update({
        where: { id },
        data: {
          status: "TRANSCRIBED",
          transcript: result.text,
          // Pre-populate subtitles with Chinese (will be overwritten on translate)
          subtitles: JSON.stringify(segments),
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

  return NextResponse.json({ success: true, message: "Transcription started" });
}
