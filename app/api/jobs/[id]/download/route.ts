/**
 * POST /api/jobs/:id/download
 * Trigger yt-dlp download for a job.
 * Updates job status: DOWNLOADING → DOWNLOADED
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { downloadVideo } from "@/lib/processor/downloader";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!["DISCOVERED", "FAILED"].includes(job.status)) {
    return NextResponse.json(
      { error: `Cannot download from status: ${job.status}` },
      { status: 409 }
    );
  }

  // Mark as downloading
  await prisma.job.update({
    where: { id },
    data: { status: "DOWNLOADING", errorMsg: "" },
  });

  // Run download asynchronously (don't block the HTTP response)
  (async () => {
    try {
      const result = await downloadVideo(job.sourceUrl, id);
      await prisma.job.update({
        where: { id },
        data: {
          status: "DOWNLOADED",
          localVideoPath: result.filePath,
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

  return NextResponse.json({ success: true, message: "Download started" });
}
