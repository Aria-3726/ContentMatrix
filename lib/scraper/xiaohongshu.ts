/**
 * Xiaohongshu (小红书 / RedNote) content scraper.
 *
 * Supports both video notes and image notes (IMAGE_NOTE type).
 *
 * Architecture:
 *   - Primary: Hit the search API at edith.xiaohongshu.com with cookies
 *   - The API requires X-s, X-t, X-s-common signature headers which rotate monthly
 *   - If signatures are stale / missing, falls back to SSR data from note pages
 *
 * Requires XIAOHONGSHU_COOKIE env var from a logged-in browser session.
 *
 * Cookie 获取方法:
 *   1. 浏览器打开 xiaohongshu.com 并登录
 *   2. F12 → Network → 刷新 → 复制任意请求的 Cookie header
 */

import type { ScraperResult } from "@/lib/db/types";

export interface XhsSearchOptions {
  keyword: string;
  page?: number;
  pageSize?: number;
  minViews?: number;       // Note: XHS doesn't expose view count publicly
  minLikes?: number;       // Use likes as primary filter instead
  noteType?: 0 | 1 | 2;   // 0=all, 1=video, 2=image
}

/** Shape of a note_card inside search results */
interface XhsNoteCard {
  type?: "normal" | "video";
  display_title?: string;
  desc?: string;
  user?: {
    user_id?: string;
    nickname?: string;
    avatar?: string;
  };
  interact_info?: {
    liked_count?: string;
    collected_count?: string;
    comment_count?: string;
    share_count?: string;
  };
  cover?: {
    height?: number;
    width?: number;
    info_list?: { image_scene?: string; url?: string }[];
  };
  image_list?: {
    height?: number;
    width?: number;
    info_list?: { image_scene?: string; url?: string }[];
  }[];
  video?: {
    consumer?: { origin_video_key?: string };
    duration?: number; // seconds
  };
  tag_list?: { name?: string }[];
  time?: number;
  last_update_time?: number;
}

interface XhsSearchItem {
  id?: string;
  model_type?: string;
  note_card?: XhsNoteCard;
  xsec_token?: string;
}

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Origin: "https://www.xiaohongshu.com",
  Referer: "https://www.xiaohongshu.com/",
};

/**
 * Parse like count string ("1.2万", "567") to number.
 */
function parseLikeCount(s: string | undefined): number {
  if (!s) return 0;
  if (s.endsWith("万")) return Math.round(parseFloat(s) * 10000);
  return parseInt(s, 10) || 0;
}

/**
 * Get cover image URL from a note card.
 */
function getCoverUrl(card: XhsNoteCard): string {
  const infoList = card.cover?.info_list ?? [];
  // Prefer WB_DFT (default web) or first available
  const dft = infoList.find((i) => i.image_scene === "WB_DFT");
  const url = dft?.url ?? infoList[0]?.url ?? "";
  return url.startsWith("//") ? `https:${url}` : url;
}

/**
 * Primary approach: Call the Xiaohongshu search API directly.
 * Requires valid cookies with a1, web_session, webId.
 * May fail if X-s/X-t/X-s-common signatures are required and not provided.
 */
async function fetchSearchAPI(
  keyword: string,
  page: number,
  pageSize: number,
  noteType: number
): Promise<XhsSearchItem[]> {
  const cookieStr = process.env.XIAOHONGSHU_COOKIE;
  if (!cookieStr) {
    throw new Error(
      "需要设置 XIAOHONGSHU_COOKIE 环境变量才能搜索小红书内容。\n" +
        "获取方法：浏览器登录 xiaohongshu.com → F12 → Network → 复制 Cookie"
    );
  }

  const url = "https://edith.xiaohongshu.com/api/sns/web/v1/search/notes";

  const body = JSON.stringify({
    keyword,
    page,
    page_size: pageSize,
    search_id: generateSearchId(),
    sort: "general",
    note_type: noteType,
    image_formats: ["jpg", "webp", "avif"],
    ext_flags: [],
  });

  // Extract a1 cookie for potential signing
  const a1Match = cookieStr.match(/(?:^|;\s*)a1=([^;]+)/);
  const a1 = a1Match?.[1] ?? "";

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      ...COMMON_HEADERS,
      Cookie: cookieStr,
      "Content-Type": "application/json;charset=UTF-8",
      // Basic X-s-common header (may not be sufficient for all requests)
      "X-s-common": generateBasicXsCommon(a1),
    },
    body,
  });

  if (resp.status === 461) {
    throw new Error(
      "小红书需要签名验证（HTTP 461）。Cookie 可能已过期，请在浏览器中重新登录后更新 XIAOHONGSHU_COOKIE"
    );
  }

  if (!resp.ok) {
    throw new Error(`小红书搜索 API 返回 ${resp.status}: ${resp.statusText}`);
  }

  const json = (await resp.json()) as {
    success?: boolean;
    data?: { has_more?: boolean; items?: XhsSearchItem[] };
    msg?: string;
    code?: number;
  };

  if (!json.success) {
    throw new Error(
      `小红书搜索失败: ${json.msg ?? "unknown"} (code: ${json.code})`
    );
  }

  return json.data?.items ?? [];
}

/**
 * Fallback: Fetch the search page HTML and try to extract embedded data.
 * Xiaohongshu search pages load results via AJAX, so this is unlikely
 * to find search results — but we try as a best-effort fallback.
 */
async function fetchSSRSearchData(
  keyword: string
): Promise<XhsSearchItem[]> {
  const cookieStr = process.env.XIAOHONGSHU_COOKIE;
  if (!cookieStr) return [];

  const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`;

  const resp = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Cookie: cookieStr,
    },
  });

  if (!resp.ok) return [];

  const html = await resp.text();

  // Try to find __INITIAL_STATE__ embedded data
  const stateMatch = html.match(
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/
  );

  if (!stateMatch?.[1]) return [];

  try {
    // Xiaohongshu uses `undefined` in the JSON-like state, replace with null
    const cleaned = stateMatch[1].replace(/\bundefined\b/g, "null");
    const state = JSON.parse(cleaned) as Record<string, unknown>;

    // Try to find search results in the state
    const items = extractNotesFromState(state);
    return items;
  } catch {
    return [];
  }
}

/**
 * Walk the __INITIAL_STATE__ looking for note-like objects.
 */
function extractNotesFromState(
  state: Record<string, unknown>
): XhsSearchItem[] {
  const items: XhsSearchItem[] = [];

  function walk(obj: unknown, depth: number): void {
    if (depth > 6 || items.length > 50) return;

    if (Array.isArray(obj)) {
      const hasNotes = obj.some(
        (item) => item && typeof item === "object" && "note_card" in item
      );
      if (hasNotes) {
        for (const item of obj) {
          if (item && typeof item === "object" && "note_card" in item) {
            items.push(item as XhsSearchItem);
          }
        }
        return;
      }
      for (const item of obj) walk(item, depth + 1);
    } else if (obj && typeof obj === "object") {
      for (const val of Object.values(obj)) walk(val, depth + 1);
    }
  }

  walk(state, 0);
  return items;
}

/**
 * Generate a random search_id (UUID-like hex string).
 */
function generateSearchId(): string {
  const hex = "0123456789abcdef";
  let id = "";
  for (let i = 0; i < 32; i++) {
    id += hex[Math.floor(Math.random() * 16)];
  }
  return id;
}

/**
 * Generate a basic X-s-common header.
 * This is a simplified version — the real algorithm rotates.
 * It may be enough with fresh cookies, but not always.
 */
function generateBasicXsCommon(a1: string): string {
  // Minimal X-s-common header (platform context)
  // The real one is computed from an obfuscated JS function
  const payload = {
    s0: 5,   // platform (5 = web)
    s1: "",
    x0: "1",
    x1: "3.9.1", // web app version (approximate)
    x2: "Windows",
    x3: "xhs-pc-web",
    x4: "4.27.3",
    x5: a1,
    x6: Date.now(),
    x7: "",
    x8: "",
    x9: "",
    x10: 0,
  };

  try {
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  } catch {
    return "";
  }
}

/**
 * Search Xiaohongshu for notes matching the given keyword.
 * Returns both video and image notes.
 */
export async function searchXiaohongshu(
  opts: XhsSearchOptions
): Promise<ScraperResult[]> {
  const {
    keyword,
    page = 1,
    pageSize = 20,
    minLikes = 100,
    noteType = 0, // all types
  } = opts;

  let items: XhsSearchItem[] = [];
  let lastError: Error | null = null;

  // Strategy 1: Direct API call
  try {
    items = await fetchSearchAPI(keyword, page, pageSize, noteType);
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err));
    console.warn("[xiaohongshu] API call failed:", lastError.message);
  }

  // Strategy 2: SSR data extraction
  if (items.length === 0) {
    try {
      items = await fetchSSRSearchData(keyword);
    } catch (err) {
      const ssrErr = err instanceof Error ? err : new Error(String(err));
      console.warn("[xiaohongshu] SSR extraction failed:", ssrErr.message);
      if (lastError) throw lastError;
      throw ssrErr;
    }
  }

  if (items.length === 0 && lastError) {
    throw lastError;
  }

  // Map to ScraperResult
  return items
    .filter((item) => {
      if (!item.id || !item.note_card) return false;
      const likes = parseLikeCount(item.note_card.interact_info?.liked_count);
      if (likes < minLikes) return false;
      return true;
    })
    .map((item) => {
      const card = item.note_card!;
      const isVideo = card.type === "video";
      const likes = parseLikeCount(card.interact_info?.liked_count);
      const durationSec = isVideo ? (card.video?.duration ?? 0) : 0;

      return {
        platform: "XIAOHONGSHU",
        sourceId: item.id!,
        sourceType: isVideo ? "VIDEO" : "IMAGE_NOTE",
        sourceUrl: `https://www.xiaohongshu.com/explore/${item.id}`,
        title: card.display_title ?? "",
        description: card.desc ?? card.display_title ?? "",
        thumbnail: getCoverUrl(card),
        duration: durationSec,
        viewCount: 0, // XHS doesn't expose view count publicly
        likeCount: likes,
        authorName: card.user?.nickname ?? "",
        authorId: card.user?.user_id ?? "",
        publishedAt: card.time
          ? new Date(card.time * 1000).toISOString()
          : new Date().toISOString(),
      };
    });
}
