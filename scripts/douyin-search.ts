/**
 * 抖音搜索子进程入口
 *
 * 由 lib/scraper/douyin-browser.ts 的 searchDouyinBrowser() 通过 execFile 调用。
 * argv[2] = JSON 序列化的 DouyinBrowserSearchOptions
 * stdout  = { ok: true, data: ScraperResult[] } | { ok: false, error: string }
 *
 * 反检测措施：
 *   - puppeteer-extra-plugin-stealth（覆盖 40+ 个指纹检测点）
 *   - 优先使用系统 Chrome（fingerprint 与真实用户一致）
 *   - 持久化 userDataDir（profile 有历史记录，更像真实用户）
 *   - 随机延迟模拟人类操作节奏
 */

import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import type { ScraperResult } from "@/lib/db/types";
import {
  DOUYIN_BROWSER_DATA_DIR,
  findChromePath,
  type DouyinBrowserSearchOptions,
} from "@/lib/scraper/douyin-browser";

puppeteerExtra.use(StealthPlugin());

// ── 工具函数 ──────────────────────────────────────────────────

/** 随机延迟，模拟人类操作节奏 */
const randomSleep = (minMs = 800, maxMs = 2500) =>
  new Promise((r) => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));

// ── 内部类型 ──────────────────────────────────────────────────

interface DouyinAweme {
  aweme_id?: string;
  desc?: string;
  create_time?: number;
  author?: { uid?: string; sec_uid?: string; nickname?: string };
  statistics?: { play_count?: number; digg_count?: number };
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

// ── 搜索核心逻辑 ──────────────────────────────────────────────

async function runSearch(opts: DouyinBrowserSearchOptions): Promise<ScraperResult[]> {
  const {
    keyword,
    minViews = 5000,
    minDuration = 10,
    maxDuration = 600,
    timeoutMs = 35_000,
  } = opts;

  // 清理残留进程和锁文件
  try {
    execFileSync("pkill", ["-f", DOUYIN_BROWSER_DATA_DIR], { stdio: "ignore" });
  } catch { /* pkill 无匹配时退出码 1，忽略 */ }
  const lockFile = path.join(DOUYIN_BROWSER_DATA_DIR, "SingletonLock");
  if (fs.existsSync(lockFile)) { try { fs.unlinkSync(lockFile); } catch { /**/ } }
  await randomSleep(800, 1200); // 给系统时间完成进程清理

  const chromePath = findChromePath();
  if (chromePath) process.stderr.write(`[douyin-search] 使用系统 Chrome: ${chromePath}\n`);

  const browser = await puppeteerExtra.launch({
    headless: true,
    executablePath: chromePath,
    userDataDir: DOUYIN_BROWSER_DATA_DIR,
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
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    const awemes: DouyinAweme[] = [];

    const xhrReady = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(
          `抖音搜索 XHR 超时（${timeoutMs / 1000}s）\n` +
          "可能原因：\n" +
          "  1. 登录已过期 → 重新运行 npx tsx scripts/douyin-login.ts\n" +
          "  2. 触发了人机验证 → 用登录脚本（有界面）完成一次验证"
        ));
      }, timeoutMs);

      page.on("response", async (response) => {
        if (!response.url().includes("/aweme/v1/web/search/item/")) return;
        try {
          const json = (await response.json()) as SearchApiResponse;
          const rawList = json.data ?? json.aweme_list ?? [];
          for (const item of rawList) {
            const aweme = "aweme_info" in item ? item.aweme_info : (item as DouyinAweme);
            if (aweme.aweme_id) awemes.push(aweme);
          }
          process.stderr.write(`[douyin-search] XHR 捕获，共 ${awemes.length} 条\n`);
          clearTimeout(timer);
          resolve();
        } catch { /* 忽略解析错误 */ }
      });
    });

    const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`;
    process.stderr.write(`[douyin-search] 导航: ${searchUrl}\n`);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    // 随机延迟后滚动，模拟人类阅读行为
    await randomSleep(1200, 2500);
    await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 400));
    await randomSleep(500, 1000);

    await xhrReady;

    return awemes
      .filter((v) => {
        if (!v.aweme_id) return false;
        const durSec = Math.floor((v.video?.duration ?? 0) / 1000);
        if (durSec < minDuration || durSec > maxDuration) return false;
        const pc = v.statistics?.play_count ?? 0;
        if (pc > 0 && pc < minViews) return false;
        return true;
      })
      .map((v) => ({
        platform: "DOUYIN",
        sourceId: v.aweme_id!,
        sourceType: "VIDEO",
        sourceUrl: `https://www.douyin.com/video/${v.aweme_id}`,
        title: v.desc ?? "",
        description: v.desc ?? "",
        thumbnail:
          v.video?.cover?.url_list?.[0] ??
          v.video?.dynamic_cover?.url_list?.[0] ??
          "",
        duration: Math.floor((v.video?.duration ?? 0) / 1000),
        viewCount: v.statistics?.play_count ?? 0,
        likeCount: v.statistics?.digg_count ?? 0,
        authorName: v.author?.nickname ?? "",
        authorId: v.author?.sec_uid ?? v.author?.uid ?? "",
        publishedAt: v.create_time
          ? new Date(v.create_time * 1000).toISOString()
          : new Date().toISOString(),
      } satisfies ScraperResult));
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
    const opts = JSON.parse(raw) as DouyinBrowserSearchOptions;
    const data = await runSearch(opts);
    process.stdout.write(JSON.stringify({ ok: true, data }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({ ok: false, error: message }));
    process.exit(1);
  }
})();
