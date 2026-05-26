/**
 * POST /api/jobs/:id/thumbnail?t=30
 * Extract a frame from the video at time `t` (seconds) using FFmpeg.
 * Returns the thumbnail as a JPEG image.
 *
 * GET /api/jobs/:id/thumbnail
 * Returns the previously generated thumbnail if it exists.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);
const THUMB_DIR = path.join(process.cwd(), "tmp", "thumbnails");

function thumbPath(jobId: string): string {
  return path.join(THUMB_DIR, `${jobId}.jpg`);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const t = req.nextUrl.searchParams.get("t") ?? "5";

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  const videoPath = job.processedVideoPath || job.localVideoPath;
  if (!videoPath || !fs.existsSync(videoPath)) {
    return NextResponse.json({ error: "No video file" }, { status: 409 });
  }

  await fs.promises.mkdir(THUMB_DIR, { recursive: true });
  const outPath = thumbPath(id);

  try {
    await execFileAsync("ffmpeg", [
      "-ss", String(t),
      "-i", videoPath,
      "-vframes", "1",
      "-pix_fmt", "yuvj420p",
      "-q:v", "2",
      "-y",
      outPath,
    ], {
      timeout: 30_000,
      env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? "/usr/bin:/bin"}` },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const buf = await fs.promises.readFile(outPath);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-cache",
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const fp = thumbPath(id);

  if (!fs.existsSync(fp)) {
    return NextResponse.json({ error: "No thumbnail yet" }, { status: 404 });
  }

  const buf = await fs.promises.readFile(fp);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-cache",
    },
  });
}
