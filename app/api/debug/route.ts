/**
 * GET /api/debug
 * Diagnostic endpoint — shows env var status and raw Bilibili response.
 * DELETE THIS FILE before going to production.
 */
import { NextResponse } from "next/server";

export async function GET() {
  const cookie = process.env.BILIBILI_COOKIE ?? "";

  // Test Bilibili API
  let biliStatus = 0;
  let biliContentType = "";
  let biliBody = "";
  let biliCode: unknown = null;
  let fetchError = "";

  try {
    const resp = await fetch(
      "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=%E6%B4%9B%E5%85%8B%E7%8E%8B%E5%9B%BD&page=1&page_size=3",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Referer: "https://www.bilibili.com",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        cache: "no-store",
      }
    );

    biliStatus = resp.status;
    biliContentType = resp.headers.get("content-type") ?? "";
    biliBody = (await resp.text()).slice(0, 300); // first 300 chars only

    try {
      const json = JSON.parse(biliBody) as { code?: unknown };
      biliCode = json.code;
    } catch {
      // HTML response — not JSON
    }
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    cookie_set: cookie.length > 0,
    cookie_preview: cookie.length > 0 ? cookie.slice(0, 30) + "..." : "(empty)",
    proxy_env: process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? "(not set)",
    bili_http_status: biliStatus,
    bili_content_type: biliContentType,
    bili_code: biliCode,
    bili_body_preview: biliBody,
    fetch_error: fetchError,
  });
}
