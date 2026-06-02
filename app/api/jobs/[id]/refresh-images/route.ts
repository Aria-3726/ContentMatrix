/**
 * POST /api/jobs/:id/refresh-images
 * Fetch image URLs for an IMAGE_NOTE job via browser session.
 * Works from any status — updates imageUrls without changing job status.
 * Useful for jobs scraped before imageUrls support was added.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { execFile } from "child_process";
import path from "path";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (job.sourceType !== "IMAGE_NOTE") {
    return NextResponse.json(
      { error: "Only IMAGE_NOTE jobs need image URL refresh" },
      { status: 400 }
    );
  }

  const tsxBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const scriptPath = path.join(process.cwd(), "scripts", "xiaohongshu-note-images.ts");

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      tsxBin,
      [scriptPath, job.sourceUrl],
      {
        timeout: 35_000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`,
        },
      },
      (err, out, stderr) => {
        if (err) reject(new Error(`图片获取失败: ${(stderr ?? err.message).split("\n")[0]}`));
        else resolve(out);
      }
    );
    child.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
  });

  const parsed = JSON.parse(stdout) as { ok: true; imageUrls: string[] } | { ok: false; error: string };
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 500 });
  }

  await prisma.job.update({
    where: { id },
    data: {
      imageUrls: JSON.stringify(parsed.imageUrls),
      ...(job.duration === 0 ? { duration: parsed.imageUrls.length * 3 } : {}),
    },
  });

  return NextResponse.json({
    success: true,
    imageCount: parsed.imageUrls.length,
    message: `已获取 ${parsed.imageUrls.length} 张图片`,
  });
}
