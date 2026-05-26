/**
 * GET  /api/jobs/:id  — get full job detail
 * PUT  /api/jobs/:id  — update editable fields (review stage)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json() as {
    translatedTitle?: string;
    translatedDesc?: string;
    subtitles?: unknown;
    tags?: unknown;
    targetLanguage?: string;
  };

  const updates: {
    translatedTitle?: string;
    translatedDesc?: string;
    subtitles?: string;
    tags?: string;
    targetLanguage?: string;
  } = {};

  if (body.translatedTitle !== undefined) updates.translatedTitle = body.translatedTitle;
  if (body.translatedDesc !== undefined) updates.translatedDesc = body.translatedDesc;
  if (body.targetLanguage !== undefined) updates.targetLanguage = body.targetLanguage;
  if (body.subtitles !== undefined) updates.subtitles = JSON.stringify(body.subtitles);
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags);

  const job = await prisma.job.update({ where: { id }, data: updates });
  return NextResponse.json({ job });
}
