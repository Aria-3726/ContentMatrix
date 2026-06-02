/**
 * 小红书搜索子进程入口
 *
 * 由 lib/scraper/xiaohongshu.ts 的 searchXiaohongshu() 通过 execFile 调用。
 * argv[2] = JSON 序列化的 XhsSearchOptions
 * stdout  = { ok: true, data: ScraperResult[] } | { ok: false, error: string }
 *
 * 反检测措施：
 *   - puppeteer-extra-plugin-stealth（完整指纹伪装）
 *   - 优先使用系统 Chrome
 *   - 持久化 userDataDir（profile 历史更像真实用户）
 *   - 随机延迟
 */

import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import type { ScraperResult } from "@/lib/db/types";

puppeteerExtra.use(StealthPlugin());

// ── 常量 ──────────────────────────────────────────────────────

export const XHS_BROWSER_DATA_DIR = path.join(
  process.cwd(),
  ".browser-data",
  "xiaohongshu"
);

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── 工具函数 ──────────────────────────────────────────────────

const randomSleep = (minMs = 800, maxMs = 2500) =>
  new Promise((r) => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));

function findChromePath(): string | undefined {
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ].find((p) => fs.existsSync(p));
}

// ── 内部类型 ──────────────────────────────────────────────────

interface XhsNoteCard {
  type?: "normal" | "video";
  display_title?: string;
  desc?: string;
  user?: { user_id?: string; nickname?: string };
  interact_info?: { liked_count?: string };
  cover?: Record<string, unknown>;
  image_list?: Array<{
    info_list?: Array<{ image_scene?: string; url?: string }>;
    url_default?: string;
  }>;
  video?: { duration?: number };
  time?: number;
}

interface XhsSearchItem {
  id?: string;
  note_card?: XhsNoteCard;
  xsec_token?: string;
}

// ── 工具：解析点赞数 ──────────────────────────────────────────

function parseLikeCount(s: string | undefined): number {
  if (!s) return 0;
  if (s.endsWith("万")) return Math.round(parseFloat(s) * 10_000);
  return parseInt(s, 10) || 0;
}

function getCoverUrl(cover: Record<string, unknown> | undefined): string {
  if (!cover) return "";
  for (const key of ["url_default", "url_pre", "url"]) {
    const v = cover[key];
    if (typeof v === "string" && v) return v.startsWith("//") ? `https:${v}` : v;
  }
  const infoList = (cover.info_list as { url?: string }[]) ?? [];
  const url = infoList[0]?.url ?? "";
  return url.startsWith("//") ? `https:${url}` : url;
}

function getImageUrls(card: XhsNoteCard): string[] {
  if (!card.image_list?.length) return [];
  return card.image_list.map((img) => {
    const fromInfoList =
      img.info_list?.find((i) => i.image_scene === "WB_DFT")?.url ??
      img.info_list?.[0]?.url;
    const raw = fromInfoList ?? img.url_default ?? "";
    return raw.startsWith("//") ? `https:${raw}` : raw;
  }).filter(Boolean);
}

// ── 搜索核心 ──────────────────────────────────────────────────

export interface XhsBrowserSearchOptions {
  keyword: string;
  minLikes?: number;
  noteType?: 0 | 1 | 2; // 0=all, 1=video, 2=image
  timeoutMs?: number;
}

async function runSearch(opts: XhsBrowserSearchOptions): Promise<ScraperResult[]> {
  const {
    keyword,
    minLikes = 100,
    timeoutMs = 30_000,
  } = opts;

  // 清理残留进程和锁
  try {
    execFileSync("pkill", ["-f", XHS_BROWSER_DATA_DIR], { stdio: "ignore" });
  } catch { /**/ }
  const lockFile = path.join(XHS_BROWSER_DATA_DIR, "SingletonLock");
  if (fs.existsSync(lockFile)) { try { fs.unlinkSync(lockFile); } catch { /**/ } }
  await randomSleep(800, 1200);

  const chromePath = findChromePath();
  if (chromePath) process.stderr.write(`[xhs-search] 使用系统 Chrome: ${chromePath}\n`);

  const browser = await puppeteerExtra.launch({
    headless: true,
    executablePath: chromePath,
    userDataDir: XHS_BROWSER_DATA_DIR,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-features=VizDisplayCompositor",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    const items: XhsSearchItem[] = [];

    const xhrReady = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `小红书搜索 XHR 超时（${timeoutMs / 1000}s）\n` +
          "可能原因：\n" +
          "  1. 登录已过期 → 重新运行 npx tsx scripts/xiaohongshu-login.ts\n" +
          "  2. 触发了验证码 → 用登录脚本（有界面）完成验证"
        ));
      }, timeoutMs);

      page.on("response", async (response) => {
        const url = response.url();
        if (!url.includes("/api/sns/web/v1/search/notes")) return;
        try {
          const json = (await response.json()) as {
            success?: boolean;
            data?: { items?: XhsSearchItem[] };
            code?: number;
          };
          if (json.success && json.data?.items?.length) {
            items.push(...json.data.items);
            process.stderr.write(`[xhs-search] XHR 捕获，共 ${items.length} 条\n`);
            clearTimeout(timer);
            resolve();
          }
        } catch { /**/ }
      });
    });

    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`;
    process.stderr.write(`[xhs-search] 导航: ${searchUrl}\n`);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    // 随机延迟 + 滚动，模拟人类浏览
    await randomSleep(1500, 3000);
    await page.evaluate(() => window.scrollBy(0, 200 + Math.random() * 300));
    await randomSleep(500, 1200);

    await xhrReady;

    return items
      .filter((item) => {
        if (!item.id || !item.note_card) return false;
        const likes = parseLikeCount(item.note_card.interact_info?.liked_count);
        return likes >= minLikes;
      })
      .map((item) => {
        const card = item.note_card!;
        const isVideo = card.type === "video";
        const likes = parseLikeCount(card.interact_info?.liked_count);
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
          thumbnail: getCoverUrl(card.cover as Record<string, unknown>),
          duration: isVideo ? (card.video?.duration ?? 0) : 0,
          viewCount: 0,
          likeCount: likes,
          authorName: card.user?.nickname ?? "",
          authorId: card.user?.user_id ?? "",
          publishedAt: card.time
            ? new Date(card.time * 1000).toISOString()
            : new Date().toISOString(),
          imageUrls: isVideo ? [] : getImageUrls(card),
        } satisfies ScraperResult;
      });
  } finally {
    await browser.close().catch(() => { /**/ });
  }
}

// ── 入口 ──────────────────────────────────────────────────────

(async () => {
  const raw = process.argv[2];
  if (!raw) {
    process.stdout.write(JSON.stringify({ ok: false, error: "缺少参数" }));
    process.exit(1);
  }
  try {
    const opts = JSON.parse(raw) as XhsBrowserSearchOptions;
    const data = await runSearch(opts);
    process.stdout.write(JSON.stringify({ ok: true, data }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({ ok: false, error: message }));
    process.exit(1);
  }
})();
