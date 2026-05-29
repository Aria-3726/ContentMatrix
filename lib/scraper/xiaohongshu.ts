/**
 * Xiaohongshu (小红书 / RedNote) content scraper.
 *
 * Uses Puppeteer to automate the XHS search page. The browser handles
 * all signature generation (X-s, X-t, X-s-common) automatically.
 * We intercept the internal API response to get clean JSON data.
 *
 * Requires XIAOHONGSHU_COOKIE env var from a logged-in browser session.
 *
 * Cookie 获取方法:
 *   1. 浏览器打开 xiaohongshu.com 并登录
 *   2. F12 → Network → 刷新 → 复制任意请求的 Cookie header
 */

import type { ScraperResult } from "@/lib/db/types";
import puppeteer, { type Browser, type CookieParam } from "puppeteer";

export interface XhsSearchOptions {
  keyword: string;
  page?: number;
  pageSize?: number;
  minViews?: number;
  minLikes?: number;
  noteType?: 0 | 1 | 2; // 0=all, 1=video, 2=image
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
    duration?: number;
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

// ── Cookie helpers ────────────────────────────────────────────

function parseCookieString(cookieStr: string): CookieParam[] {
  return cookieStr
    .split(";")
    .map((pair) => {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) return null;
      const name = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();
      if (!name) return null;
      return {
        name,
        value,
        domain: ".xiaohongshu.com",
        path: "/",
      } as CookieParam;
    })
    .filter((c): c is CookieParam => c !== null);
}

// ── Data helpers ─────────────────────────────────────────────

function parseLikeCount(s: string | undefined): number {
  if (!s) return 0;
  if (s.endsWith("万")) return Math.round(parseFloat(s) * 10000);
  return parseInt(s, 10) || 0;
}

function getCoverUrl(card: XhsNoteCard): string {
  // Try multiple cover URL sources — XHS format varies
  const cover = card.cover as Record<string, unknown> | undefined;
  if (!cover) return "";

  // Direct URL fields (most common in search results)
  for (const key of ["url_default", "url_pre", "url"]) {
    const val = cover[key];
    if (typeof val === "string" && val.length > 0) {
      return val.startsWith("//") ? `https:${val}` : val;
    }
  }

  // info_list fallback (note detail pages)
  const infoList = (cover.info_list as { image_scene?: string; url?: string }[]) ?? [];
  const dft = infoList.find((i) => i.image_scene === "WB_DFT");
  const url = dft?.url ?? infoList[0]?.url ?? "";
  return url.startsWith("//") ? `https:${url}` : url;
}

// ── Browser-based search ─────────────────────────────────────

/**
 * Search XHS using Puppeteer. The browser handles signature generation.
 * We intercept the internal search API response for clean data.
 */
async function searchWithBrowser(
  keyword: string,
  cookieStr: string
): Promise<XhsSearchItem[]> {
  let browser: Browser | null = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const page = await browser.newPage();

    // Mask automation signals
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      // @ts-expect-error -- removing chrome automation traces
      delete navigator.__proto__.webdriver;
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    // Set cookies from env var
    const cookies = parseCookieString(cookieStr);
    await page.setCookie(...cookies);

    // Set up response interception to capture search API results
    const apiResultPromise = new Promise<XhsSearchItem[]>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn("[xiaohongshu] Timed out waiting for search API response");
        resolve([]);
      }, 25_000);

      page.on("response", async (response) => {
        const url = response.url();
        if (url.includes("/api/sns/web/v1/search/notes")) {
          try {
            const json = (await response.json()) as {
              success?: boolean;
              data?: { items?: XhsSearchItem[] };
              code?: number;
              msg?: string;
            };
            if (json.success && json.data?.items) {
              clearTimeout(timeout);
              resolve(json.data.items);
            } else if (json.code) {
              console.warn(
                `[xiaohongshu] Search API returned code ${json.code}: ${json.msg}`
              );
              // Don't resolve yet — might get a retry
            }
          } catch {
            // Response wasn't JSON — ignore
          }
        }
      });
    });

    // Navigate to search page
    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`;
    console.log("[xiaohongshu] Navigating to search page...");

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    // Wait for search results to load
    console.log("[xiaohongshu] Waiting for search results...");
    const items = await apiResultPromise;

    console.log(`[xiaohongshu] Got ${items.length} results from browser`);
    return items;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Fallback: extract __INITIAL_STATE__ from the SSR HTML.
 * XHS embeds some data in the page, though search results
 * are typically loaded via AJAX.
 */
async function searchFromSSR(
  keyword: string,
  cookieStr: string
): Promise<XhsSearchItem[]> {
  const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Cookie: cookieStr,
    },
  });

  if (!resp.ok) return [];

  const html = await resp.text();

  // Find __INITIAL_STATE__ — use indexOf for robustness
  const marker = "window.__INITIAL_STATE__=";
  const idx = html.indexOf(marker);
  if (idx === -1) return [];

  const start = idx + marker.length;
  const scriptEnd = html.indexOf("</script>", start);
  if (scriptEnd === -1) return [];

  let jsonStr = html.substring(start, scriptEnd).trim();
  // Remove trailing semicolons
  jsonStr = jsonStr.replace(/;\s*$/, "");
  // XHS uses `undefined` in state — replace with null
  jsonStr = jsonStr.replace(/\bundefined\b/g, "null");

  try {
    const state = JSON.parse(jsonStr) as Record<string, unknown>;
    return extractNotesFromState(state);
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

// ── Main export ──────────────────────────────────────────────

/**
 * Search Xiaohongshu for notes matching the given keyword.
 *
 * Strategy:
 *   1. Puppeteer browser (handles signatures automatically)
 *   2. SSR __INITIAL_STATE__ extraction (fallback)
 */
export async function searchXiaohongshu(
  opts: XhsSearchOptions
): Promise<ScraperResult[]> {
  const { keyword, minLikes = 100 } = opts;

  const cookieStr = process.env.XIAOHONGSHU_COOKIE;
  if (!cookieStr) {
    throw new Error(
      "需要设置 XIAOHONGSHU_COOKIE 环境变量才能搜索小红书内容。\n" +
        "获取方法：浏览器登录 xiaohongshu.com → F12 → Network → 复制 Cookie"
    );
  }

  let items: XhsSearchItem[] = [];

  // Strategy 1: Puppeteer browser search
  try {
    items = await searchWithBrowser(keyword, cookieStr);
  } catch (err) {
    console.warn(
      "[xiaohongshu] Browser search failed:",
      err instanceof Error ? err.message : err
    );
  }

  // Strategy 2: SSR fallback
  if (items.length === 0) {
    try {
      items = await searchFromSSR(keyword, cookieStr);
    } catch (err) {
      console.warn(
        "[xiaohongshu] SSR extraction failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  if (items.length === 0) {
    throw new Error(
      "小红书搜索未返回结果。可能原因：Cookie 已过期或被限流。\n" +
        "请在浏览器中重新登录 xiaohongshu.com 并更新 XIAOHONGSHU_COOKIE"
    );
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

      // XHS requires xsec_token in URL to view notes found via search
      const xsecParam = item.xsec_token
        ? `?xsec_token=${encodeURIComponent(item.xsec_token)}&xsec_source=pc_search`
        : "";

      return {
        platform: "XIAOHONGSHU",
        sourceId: item.id!,
        sourceType: isVideo ? "VIDEO" : "IMAGE_NOTE",
        sourceUrl: `https://www.xiaohongshu.com/explore/${item.id}${xsecParam}`,
        title: card.display_title ?? "",
        description: card.desc ?? card.display_title ?? "",
        thumbnail: getCoverUrl(card),
        duration: durationSec,
        viewCount: 0,
        likeCount: likes,
        authorName: card.user?.nickname ?? "",
        authorId: card.user?.user_id ?? "",
        publishedAt: card.time
          ? new Date(card.time * 1000).toISOString()
          : new Date().toISOString(),
      };
    });
}
