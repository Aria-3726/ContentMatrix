/**
 * GET /api/jobs          — list all jobs (with optional status filter)
 * DELETE /api/jobs?id=x  — delete a job
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const jobs = await prisma.job.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      platform: true,
      sourceId: true,
      sourceType: true,
      title: true,
      thumbnail: true,
      duration: true,
      viewCount: true,
      likeCount: true,
      authorName: true,
      status: true,
      errorMsg: true,
      targetLanguage: true,
      translatedTitle: true,
      youtubeUrl: true,
      createdAt: true,
      updatedAt: true,
      sourceUrl: true,
    },
  });

  return NextResponse.json({ jobs });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await prisma.job.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
