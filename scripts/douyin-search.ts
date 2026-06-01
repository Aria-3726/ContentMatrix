/**
 * 抖音搜索子进程入口
 *
 * 由 lib/scraper/douyin-browser.ts 的 searchDouyinBrowser() 通过 execFile 调用。
 * argv[2] = JSON 序列化的 DouyinBrowserSearchOptions
 * 成功: 向 stdout 输出 { ok: true, data: ScraperResult[] }
 * 失败: 向 stdout 输出 { ok: false, error: string }，exit code 1
 *
 * 不要直接运行此脚本，请用 searchDouyinBrowser() 调用。
 * 如需调试，使用: npx tsx scripts/debug-douyin.ts
 */

import puppeteer from "puppeteer";
import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";
import type { ScraperResult } from "@/lib/db/types";
import {
  DOUYIN_BROWSER_DATA_DIR,
  findChromePath,
  DouyinBrowserSearchOptions,
} from "@/lib/scraper/douyin-browser";

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
  } catch { /* 没有匹配进程时 pkill 返回 1，忽略 */ }
  const lockFile = path.join(DOUYIN_BROWSER_DATA_DIR, "SingletonLock");
  if (fs.existsSync(lockFile)) { try { fs.unlinkSync(lockFile); } catch { /**/ } }
  await new Promise((r) => setTimeout(r, 800));

  const chromePath = findChromePath();
  if (chromePath) process.stderr.write(`[douyin-search] 使用系统 Chrome: ${chromePath}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
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
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

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
    await page.evaluate(() => window.scrollBy(0, 500));
    await xhrReady;

    return awemes
      .filter((v) => {
        if (!v.aweme_id) return false;
        const durSec = Math.floor((v.video?.duration ?? 0) / 1000);
        if (durSec < minDuration || durSec > maxDuration) return false;
        // 抖音搜索 API 不含播放量，play_count=0 时跳过该过滤
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

// ── 入口：解析参数、运行、输出 JSON ──────────────────────────

(async () => {
  const raw = process.argv[2];
  if (!raw) {
    process.stdout.write(JSON.stringify({ ok: false, error: "缺少参数" }));
    process.exit(1);
  }

  let opts: DouyinBrowserSearchOptions;
  try {
    opts = JSON.parse(raw) as DouyinBrowserSearchOptions;
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: "参数 JSON 解析失败" }));
    process.exit(1);
  }

  try {
    const data = await runSearch(opts);
    process.stdout.write(JSON.stringify({ ok: true, data }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({ ok: false, error: message }));
    process.exit(1);
  }
})();
