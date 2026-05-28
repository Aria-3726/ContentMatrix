/**
 * GET /api/proxy/image?url=...
 * Proxy thumbnails from Bilibili / Douyin / Xiaohongshu CDNs with correct
 * Referer headers. These CDNs block direct browser requests from other origins.
 */

import { NextRequest, NextResponse } from "next/server";

/** Allowed CDN domains → required Referer */
const ALLOWED_DOMAINS: { pattern: string; referer: string }[] = [
  // Bilibili
  { pattern: "hdslb.com",       referer: "https://www.bilibili.com/" },
  { pattern: "biliimg.com",     referer: "https://www.bilibili.com/" },
  { pattern: "bstarstatic.com", referer: "https://www.bilibili.com/" },
  // Douyin
  { pattern: "douyinpic.com",   referer: "https://www.douyin.com/" },
  { pattern: "byteimg.com",     referer: "https://www.douyin.com/" },
  { pattern: "bytetos.com",     referer: "https://www.douyin.com/" },
  { pattern: "tiktokcdn.com",   referer: "https://www.douyin.com/" },
  // Xiaohongshu
  { pattern: "xhscdn.com",     referer: "https://www.xiaohongshu.com/" },
  { pattern: "xiaohongshu.com", referer: "https://www.xiaohongshu.com/" },
];

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const match = ALLOWED_DOMAINS.find((d) => hostname.endsWith(d.pattern));
  if (!match) {
    return NextResponse.json({ error: "domain not allowed" }, { status: 403 });
  }

  try {
    const resp = await fetch(url, {
      headers: {
        Referer: match.referer,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `upstream ${resp.status}` },
        { status: 502 }
      );
    }

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await resp.arrayBuffer());

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
