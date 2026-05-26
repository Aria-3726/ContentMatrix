/**
 * POST /api/scrape
 * Search Bilibili and return results + auto-create Job records for new ones.
 *
 * Body: { keyword: string, page?: number, minViews?: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { searchBilibili } from "@/lib/scraper/bilibili";
import { prisma } from "@/lib/db/client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { keyword, page = 1, minViews = 5000 } = body as {
      keyword?: string;
      page?: number;
      minViews?: number;
    };

    if (!keyword?.trim()) {
      return NextResponse.json(
        { error: "keyword is required" },
        { status: 400 }
      );
    }

    const results = await searchBilibili({ keyword, page, minViews });

    // Upsert into DB — skip if bvid already exists
    const created: string[] = [];
    const existing: string[] = [];

    for (const r of results) {
      const exists = await prisma.job.findUnique({ where: { bvid: r.bvid } });
      if (exists) {
        existing.push(r.bvid);
        continue;
      }
      await prisma.job.create({
        data: {
          bvid: r.bvid,
          sourceUrl: r.sourceUrl,
          title: r.title,
          description: r.description,
          thumbnail: r.thumbnail,
          duration: r.duration,
          viewCount: r.viewCount,
          likeCount: r.likeCount,
          authorName: r.authorName,
          authorId: r.authorId,
          publishedAt: r.publishedAt,
          status: "DISCOVERED",
        },
      });
      created.push(r.bvid);
    }

    return NextResponse.json({
      total: results.length,
      created: created.length,
      existing: existing.length,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
