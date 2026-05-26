/**
 * POST /api/jobs/:id/translate
 * Translate transcription using GPT-4o.
 * Body: { targetLanguage?: "EN" | "JA" | "KO" }
 * Updates job status: TRANSLATING → TRANSLATED → REVIEW_PENDING
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { translateContent } from "@/lib/processor/translator";
import type { TargetLanguage } from "@/lib/db/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { targetLanguage?: TargetLanguage };

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (job.status !== "TRANSCRIBED") {
    return NextResponse.json(
      { error: `Must be TRANSCRIBED to translate. Current: ${job.status}` },
      { status: 409 }
    );
  }

  const targetLanguage: TargetLanguage =
    body.targetLanguage ?? (job.targetLanguage as TargetLanguage) ?? "EN";

  await prisma.job.update({
    where: { id },
    data: { status: "TRANSLATING", errorMsg: "", targetLanguage },
  });

  (async () => {
    try {
      const segments = JSON.parse(job.subtitles || "[]") as Array<{
        start: number;
        end: number;
        text: string;
      }>;

      const result = await translateContent({
        title: job.title,
        description: job.description,
        segments,
        targetLanguage,
      });

      await prisma.job.update({
        where: { id },
        data: {
          status: "TRANSLATED",
          translatedTitle: result.title,
          translatedDesc: result.description,
          subtitles: JSON.stringify(result.subtitles),
          tags: JSON.stringify(result.tags),
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

  return NextResponse.json({ success: true, message: "Translation started" });
}
