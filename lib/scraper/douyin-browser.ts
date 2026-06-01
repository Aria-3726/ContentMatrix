/**
 * 抖音搜索 — Puppeteer 浏览器方案（主力）
 *
 * 原理：
 *   抖音搜索 API 需要 `a_bogus` 签名参数，该参数由浏览器端 JS 动态计算，
 *   服务端会校验，无法直接伪造。本方案让真实浏览器打开抖音搜索页，
 *   抖音自己的 JS 自动生成签名，我们只需拦截 XHR 响应获取视频列表。
 *
 * 前置条件：
 *   运行 `npx tsx scripts/douyin-login.ts` 完成一次性登录，
 *   浏览器 Session 保存到 .browser-data/douyin/，有效期约 30 天。
 *
 * 用法（直接调用，不需要 DOUYIN_COOKIE 环境变量）：
 *   import { searchDouyinBrowser } from "@/lib/scraper/douyin-browser";
 *   const results = await searchDouyinBrowser({ keyword: "原神", minViews: 10000 });
 */

import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";
import type { ScraperResult } from "@/lib/db/types";

export const DOUYIN_BROWSER_DATA_DIR = path.join(
  process.cwd(),
  ".browser-data",
  "douyin"
);

/** 优先使用系统 Chrome（内置 Chromium 在 macOS 上对部分站点有网络兼容问题） */
function findChromePath(): string | undefined {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => fs.existsSync(p));
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── 内部类型 ──────────────────────────────────────────────────

interface DouyinAweme {
  aweme_id?: string;
  desc?: string;
  create_time?: number;
  author?: {
    uid?: string;
    sec_uid?: string;
    nickname?: string;
  };
  statistics?: {
    play_count?: number;
    digg_count?: number;
  };
  video?: {
    cover?: { url_list?: string[] };
    dynamic_cover?: { url_list?: string[] };
    duration?: number; // 毫秒
  };
}

type SearchApiResponse = {
  status_code?: number;
  data?: Array<DouyinAweme | { aweme_info: DouyinAweme }>;
  aweme_list?: Array<DouyinAweme | { aweme_info: DouyinAweme }>;
};

// ── 会话检查 ──────────────────────────────────────────────────

function assertSessionExists(): void {
  const cookiesFile = path.join(DOUYIN_BROWSER_DATA_DIR, "Default", "Cookies");
  if (!fs.existsSync(cookiesFile)) {
    throw new Error(
      "未找到抖音登录会话，请先运行：\n\n" +
        "  npx tsx scripts/douyin-login.ts\n\n" +
        "在打开的浏览器窗口中登录抖音账号，然后关闭窗口。\n" +
        "登录状态会保存到 .browser-data/douyin/，后续搜索自动使用。"
    );
  }
}

// ── 主函数 ────────────────────────────────────────────────────

export interface DouyinBrowserSearchOptions {
  keyword: string;
  minViews?: number;
  minDuration?: number; // 秒
  maxDuration?: number; // 秒
  timeoutMs?: number;
}

/**
 * 用真实浏览器搜索抖音视频，拦截 XHR 响应获取视频列表。
 * 需要提前运行 `npx tsx scripts/douyin-login.ts` 完成登录。
 */
export async function searchDouyinBrowser(
  opts: DouyinBrowserSearchOptions
): Promise<ScraperResult[]> {
  const {
    keyword,
    minViews = 5000,
    minDuration = 10,
    maxDuration = 600,
    timeoutMs = 35_000,
  } = opts;

  assertSessionExists();

  // 清理可能遗留的浏览器进程和 SingletonLock
  const { execSync } = await import("child_process");
  try { execSync(`pkill -f "${DOUYIN_BROWSER_DATA_DIR}" 2>/dev/null || true`); } catch { /* ignore */ }
  const lockFile = path.join(DOUYIN_BROWSER_DATA_DIR, "SingletonLock");
  if (fs.existsSync(lockFile)) {
    try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
  }
  // 给系统一点时间完成进程清理
  await new Promise((r) => setTimeout(r, 500));

  const chromePath = findChromePath();
  if (chromePath) {
    console.log(`[douyin-browser] 使用系统 Chrome: ${chromePath}`);
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,   // undefined → 使用内置 Chromium
    userDataDir: DOUYIN_BROWSER_DATA_DIR,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=VizDisplayCompositor",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    // 隐藏 webdriver 特征
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    const awemes: DouyinAweme[] = [];

    // 在导航前注册响应拦截，避免错过第一个 XHR
    const xhrDataReady = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `抖音搜索等待 XHR 响应超时（${timeoutMs / 1000}s）。\n` +
              "可能原因：\n" +
              "  1. 登录已过期 → 重新运行 npx tsx scripts/douyin-login.ts\n" +
              "  2. 触发了人机验证 → 用登录脚本（有界面）完成一次验证\n" +
              "  3. 网络较慢 → 可增大 timeoutMs 参数"
          )
        );
      }, timeoutMs);

      page.on("response", async (response) => {
        const url = response.url();
        if (!url.includes("/aweme/v1/web/search/item/")) return;

        try {
          const json = (await response.json()) as SearchApiResponse;
          const rawList = json.data ?? json.aweme_list ?? [];

          for (const item of rawList) {
            const aweme =
              "aweme_info" in item ? item.aweme_info : (item as DouyinAweme);
            if (aweme.aweme_id) awemes.push(aweme);
          }

          console.log(
            `[douyin-browser] 捕获 XHR，获得 ${awemes.length} 条视频数据`
          );
          clearTimeout(timer);
          resolve();
        } catch {
          // 忽略非 JSON 响应
        }
      });
    });

    const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`;
    console.log(`[douyin-browser] 打开搜索页: ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    // 模拟滚动触发懒加载（部分情况下 XHR 在滚动后才发出）
    await page.evaluate(() => window.scrollBy(0, 500));

    await xhrDataReady;

    // ── 过滤 + 映射 ────────────────────────────────────────
    return awemes
      .filter((v) => {
        if (!v.aweme_id) return false;
        const durSec = Math.floor((v.video?.duration ?? 0) / 1000);
        if (durSec < minDuration || durSec > maxDuration) return false;
        // 抖音搜索 API 不返回播放量，play_count 为 0 时跳过该过滤
        const playCount = v.statistics?.play_count ?? 0;
        if (playCount > 0 && playCount < minViews) return false;
        return true;
      })
      .map((v) => {
        const thumbnail =
          v.video?.cover?.url_list?.[0] ??
          v.video?.dynamic_cover?.url_list?.[0] ??
          "";

        return {
          platform: "DOUYIN",
          sourceId: v.aweme_id!,
          sourceType: "VIDEO",
          sourceUrl: `https://www.douyin.com/video/${v.aweme_id}`,
          title: v.desc ?? "",
          description: v.desc ?? "",
          thumbnail,
          duration: Math.floor((v.video?.duration ?? 0) / 1000),
          viewCount: v.statistics?.play_count ?? 0,
          likeCount: v.statistics?.digg_count ?? 0,
          authorName: v.author?.nickname ?? "",
          authorId: v.author?.sec_uid ?? v.author?.uid ?? "",
          publishedAt: v.create_time
            ? new Date(v.create_time * 1000).toISOString()
            : new Date().toISOString(),
        } satisfies ScraperResult;
      });
  } finally {
    await browser.close().catch(() => { /* ignore */ });
  }
}
