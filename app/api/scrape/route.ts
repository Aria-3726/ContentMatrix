/**
 * POST /api/scrape
 * Search content platforms and auto-create Job records for new results.
 *
 * Body: { platform?: "BILIBILI"|"DOUYIN"|"XIAOHONGSHU", keyword: string, page?: number, minViews?: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { searchBilibili } from "@/lib/scraper/bilibili";
import { searchDouyin } from "@/lib/scraper/douyin";
import { searchXiaohongshu } from "@/lib/scraper/xiaohongshu";
import { prisma } from "@/lib/db/client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { platform = "BILIBILI", keyword, page = 1, minViews = 5000 } = body as {
      platform?: string;
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

    // Dispatch to platform-specific scraper
    let results;
    switch (platform) {
      case "BILIBILI":
        results = await searchBilibili({ keyword, page, minViews });
        break;
      case "DOUYIN":
        results = await searchDouyin({ keyword, page, minViews });
        break;
      case "XIAOHONGSHU":
        results = await searchXiaohongshu({ keyword, page, minLikes: minViews });
        break;
      default:
        return NextResponse.json({ error: `Unsupported platform: ${platform}` }, { status: 400 });
    }

    // Upsert into DB — skip if platform+sourceId already exists
    const created: string[] = [];
    const existing: string[] = [];

    for (const r of results) {
      const exists = await prisma.job.findFirst({
        where: { platform: r.platform ?? platform, sourceId: r.sourceId },
      });
      if (exists) {
        existing.push(r.sourceId);
        continue;
      }
      await prisma.job.create({
        data: {
          platform: r.platform ?? platform,
          sourceId: r.sourceId,
          sourceType: r.sourceType ?? "VIDEO",
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
          // IMAGE_NOTE: persist image URLs from search result so download step can skip re-fetch
          ...(r.imageUrls?.length ? { imageUrls: JSON.stringify(r.imageUrls) } : {}),
        },
      });
      created.push(r.sourceId);
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
