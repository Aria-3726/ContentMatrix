/**
 * Douyin (抖音) content scraper
 *
 * 搜索策略（按优先级）：
 *   1. Puppeteer 浏览器方案（主力，最可靠）
 *      原理：打开真实浏览器，拦截 XHR 响应，a_bogus 由抖音自己的 JS 生成。
 *      前置：运行 `npx tsx scripts/douyin-login.ts` 完成一次性登录。
 *      实现：lib/scraper/douyin-browser.ts
 *
 *   2. SSR 页面提取（降级，需 DOUYIN_COOKIE 环境变量）
 *      原理：抓取搜索页 HTML 提取 RENDER_DATA 内嵌 JSON。
 *      注意：抖音搜索结果通常通过 XHR 加载，SSR 数据可能为空。
 *
 *   3. 直接 API 调用（降级，需 DOUYIN_COOKIE，可能因 a_bogus 缺失失败）
 *      原理：直接调用 /aweme/v1/web/search/item/ 接口。
 */

import type { ScraperResult } from "@/lib/db/types";

export interface DouyinSearchOptions {
  keyword: string;
  page?: number;
  pageSize?: number;
  minViews?: number;
  minDuration?: number;
  maxDuration?: number;
}

/** Shape of an aweme item inside RENDER_DATA or API response */
interface DouyinAweme {
  aweme_id?: string;
  desc?: string;
  create_time?: number;
  author?: {
    uid?: string;
    sec_uid?: string;
    nickname?: string;
    unique_id?: string;
  };
  statistics?: {
    play_count?: number;
    digg_count?: number;
    comment_count?: number;
    collect_count?: number;
    share_count?: number;
  };
  video?: {
    cover?: { url_list?: string[] };
    dynamic_cover?: { url_list?: string[] };
    duration?: number; // milliseconds
    play_addr?: { url_list?: string[] };
  };
}

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: "https://www.douyin.com/",
};

/**
 * Primary approach: fetch the Douyin search page HTML and extract SSR data
 * from the <script id="RENDER_DATA"> tag.
 */
async function fetchSSRSearchData(
  keyword: string,
  _page: number
): Promise<DouyinAweme[]> {
  const cookieStr = process.env.DOUYIN_COOKIE;
  if (!cookieStr) {
    throw new Error(
      "需要设置 DOUYIN_COOKIE 环境变量才能搜索抖音内容。\n" +
        "获取方法：浏览器登录 douyin.com → F12 → Network → 复制 Cookie"
    );
  }

  // Douyin search page URL
  const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`;

  const resp = await fetch(searchUrl, {
    headers: {
      ...COMMON_HEADERS,
      Cookie: cookieStr,
    },
    redirect: "follow",
  });

  if (!resp.ok) {
    throw new Error(`抖音搜索页返回 ${resp.status}: ${resp.statusText}`);
  }

  const html = await resp.text();

  // Extract RENDER_DATA script content
  const renderDataMatch = html.match(
    /<script\s+id="RENDER_DATA"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/
  );

  if (!renderDataMatch?.[1]) {
    // Check if we got a login redirect or CAPTCHA
    if (html.includes("验证") || html.includes("captcha")) {
      throw new Error("抖音需要验证码，请在浏览器中完成验证后重新获取 Cookie");
    }
    if (html.includes("登录") && html.length < 5000) {
      throw new Error("抖音 Cookie 已失效，请重新登录并更新 DOUYIN_COOKIE");
    }
    throw new Error("无法从抖音搜索页提取数据（RENDER_DATA 未找到）");
  }

  // RENDER_DATA is URL-encoded JSON
  let decoded: string;
  try {
    decoded = decodeURIComponent(renderDataMatch[1]);
  } catch {
    decoded = renderDataMatch[1];
  }

  let renderData: Record<string, unknown>;
  try {
    renderData = JSON.parse(decoded);
  } catch {
    throw new Error("抖音 RENDER_DATA JSON 解析失败");
  }

  // Navigate the RENDER_DATA structure to find video results
  // The structure varies but typically has a key like "xx_search" or a numbered key
  // that contains { data: [...aweme items] }
  const awemes = extractAwemesFromRenderData(renderData);

  if (!awemes.length) {
    // May be behind a different key structure — dump top-level keys for debugging
    console.warn(
      "[douyin] RENDER_DATA top-level keys:",
      Object.keys(renderData)
    );
  }

  return awemes;
}

/**
 * Walk the RENDER_DATA object tree looking for arrays of aweme-like objects.
 * Douyin changes the key structure periodically, so we search adaptively.
 */
function extractAwemesFromRenderData(
  data: Record<string, unknown>
): DouyinAweme[] {
  // Strategy: recursively search for arrays containing objects with `aweme_id`
  const found: DouyinAweme[] = [];

  function walk(obj: unknown, depth: number): void {
    if (depth > 8 || found.length > 0) return;

    if (Array.isArray(obj)) {
      // Check if this array contains aweme-like objects
      const hasAweme = obj.some(
        (item) =>
          item &&
          typeof item === "object" &&
          ("aweme_id" in item || ("aweme_info" in item))
      );
      if (hasAweme) {
        for (const item of obj) {
          if (item && typeof item === "object") {
            // Some structures wrap in aweme_info
            const aweme = ("aweme_info" in item)
              ? (item as { aweme_info: DouyinAweme }).aweme_info
              : (item as DouyinAweme);
            if (aweme.aweme_id) found.push(aweme);
          }
        }
        return;
      }
      // Recurse into array items
      for (const item of obj) {
        walk(item, depth + 1);
      }
    } else if (obj && typeof obj === "object") {
      for (const value of Object.values(obj)) {
        walk(value, depth + 1);
      }
    }
  }

  walk(data, 0);
  return found;
}

/**
 * Fallback approach: try the Douyin search API directly.
 * This may fail without a_bogus signature but is worth trying with fresh cookies.
 */
async function fetchAPISearchData(
  keyword: string,
  page: number,
  pageSize: number
): Promise<DouyinAweme[]> {
  const cookieStr = process.env.DOUYIN_COOKIE;
  if (!cookieStr) {
    throw new Error("需要设置 DOUYIN_COOKIE 环境变量");
  }

  const offset = (page - 1) * pageSize;

  const params = new URLSearchParams({
    keyword,
    offset: String(offset),
    count: String(pageSize),
    search_channel: "aweme_video_web",
    search_source: "normal_search",
    query_correct_type: "1",
    is_filter_search: "0",
    sort_type: "0",
    publish_time: "0",
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    cookie_enabled: "true",
    browser_language: "zh-CN",
    browser_platform: "MacIntel",
    browser_name: "Chrome",
    browser_version: "131.0.0.0",
    browser_online: "true",
    screen_width: "1920",
    screen_height: "1080",
    os_name: "Mac OS",
    os_version: "10.15.7",
    platform: "PC",
  });

  const url = `https://www.douyin.com/aweme/v1/web/search/item/?${params.toString()}`;

  const resp = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      Accept: "application/json, text/plain, */*",
      Cookie: cookieStr,
    },
  });

  if (!resp.ok) {
    throw new Error(`抖音搜索 API 返回 ${resp.status}`);
  }

  const json = (await resp.json()) as {
    status_code?: number;
    data?: DouyinAweme[] | { aweme_info: DouyinAweme }[];
    aweme_list?: DouyinAweme[];
  };

  if (json.status_code !== 0 && json.status_code !== undefined) {
    throw new Error(`抖音 API 错误 (code: ${json.status_code})`);
  }

  // Response might use "data" or "aweme_list" depending on version
  const rawList = json.data ?? json.aweme_list ?? [];

  return rawList.map((item) => {
    if ("aweme_info" in item) {
      return (item as { aweme_info: DouyinAweme }).aweme_info;
    }
    return item as DouyinAweme;
  });
}

/**
 * Search Douyin for videos matching the given keyword.
 *
 * Strategy selection:
 *   - Browser session exists (.browser-data/douyin/) → 浏览器方案（子进程 Chrome）
 *   - No browser session, DOUYIN_COOKIE set → Cookie 降级方案
 *   - Neither → 引导用户运行 douyin-login.ts
 */
export async function searchDouyin(
  opts: DouyinSearchOptions
): Promise<ScraperResult[]> {
  const {
    keyword,
    page = 1,
    pageSize = 20,
    minViews = 5000,
    minDuration = 10,
    maxDuration = 600,
  } = opts;

  // ── Strategy 1: Browser session（首选，不可静默降级到 cookie）──
  const { sessionExists, searchDouyinBrowser } = await import("./douyin-browser");
  if (sessionExists()) {
    // 有 session → 只用浏览器方案；任何错误都直接抛出，不降级
    return searchDouyinBrowser({ keyword, minViews, minDuration, maxDuration });
  }

  // ── No browser session → cookie fallback（或引导登录）────────
  if (!process.env.DOUYIN_COOKIE) {
    throw new Error(
      "未找到抖音登录会话，请先运行：\n\n" +
      "  npx tsx scripts/douyin-login.ts\n\n" +
      "在打开的浏览器中登录抖音账号，然后关闭窗口。\n" +
      "登录状态保存到 .browser-data/douyin/，后续搜索自动使用，无需重复登录。"
    );
  }

  // ── Strategy 2 & 3: Cookie-based fallback ────────────────
  let awemes: DouyinAweme[] = [];
  let lastError: Error | null = null;

  try {
    awemes = await fetchSSRSearchData(keyword, page);
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err));
    console.warn("[douyin] SSR 提取失败:", lastError.message.split("\n")[0]);
  }

  if (awemes.length === 0) {
    try {
      awemes = await fetchAPISearchData(keyword, page, pageSize);
    } catch (err) {
      const apiErr = err instanceof Error ? err : new Error(String(err));
      console.warn("[douyin] API 降级失败:", apiErr.message.split("\n")[0]);
      if (lastError) throw lastError;
      throw apiErr;
    }
  }

  return awemes
    .filter((v) => {
      const durationSec = Math.floor((v.video?.duration ?? 0) / 1000);
      if (durationSec < minDuration || durationSec > maxDuration) return false;
      // 抖音搜索 API 不返回播放量，play_count 为 0 时跳过该过滤
      const playCount = v.statistics?.play_count ?? 0;
      if (playCount > 0 && playCount < minViews) return false;
      return true;
    })
    .map((v) => {
      const durationSec = Math.floor((v.video?.duration ?? 0) / 1000);
      const cover =
        v.video?.cover?.url_list?.[0] ??
        v.video?.dynamic_cover?.url_list?.[0] ??
        "";

      return {
        platform: "DOUYIN",
        sourceId: v.aweme_id ?? "",
        sourceType: "VIDEO",
        sourceUrl: `https://www.douyin.com/video/${v.aweme_id}`,
        title: v.desc ?? "",
        description: v.desc ?? "",
        thumbnail: cover,
        duration: durationSec,
        viewCount: v.statistics?.play_count ?? 0,
        likeCount: v.statistics?.digg_count ?? 0,
        authorName: v.author?.nickname ?? "",
        authorId: v.author?.sec_uid ?? v.author?.uid ?? "",
        publishedAt: v.create_time
          ? new Date(v.create_time * 1000).toISOString()
          : new Date().toISOString(),
      };
    });
}
