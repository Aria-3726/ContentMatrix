/**
 * 小红书笔记图片 URL 提取子进程
 *
 * 由 /api/jobs/:id/refresh-images 通过 execFile 调用。
 * argv[2] = 笔记 URL (含 xsec_token)
 * stdout  = { ok: true, imageUrls: string[] } | { ok: false, error: string }
 *
 * 原理：用持久化浏览器会话打开笔记页，页面加载完成后直接从
 * window.__INITIAL_STATE__ 里提取图片列表，无需等待特定 XHR。
 */

import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";

puppeteerExtra.use(StealthPlugin());

const XHS_BROWSER_DATA_DIR = path.join(process.cwd(), ".browser-data", "xiaohongshu");
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findChromePath(): string | undefined {
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ].find((p) => fs.existsSync(p));
}

async function fetchNoteImages(noteUrl: string): Promise<string[]> {
  // 清理残留锁
  try { execFileSync("pkill", ["-f", XHS_BROWSER_DATA_DIR], { stdio: "ignore" }); } catch { /**/ }
  const lockFile = path.join(XHS_BROWSER_DATA_DIR, "SingletonLock");
  if (fs.existsSync(lockFile)) { try { fs.unlinkSync(lockFile); } catch { /**/ } }
  await sleep(800);

  const chromePath = findChromePath();
  if (chromePath) process.stderr.write(`[xhs-images] 使用系统 Chrome: ${chromePath}\n`);

  const browser = await puppeteerExtra.launch({
    headless: true,
    executablePath: chromePath,
    userDataDir: XHS_BROWSER_DATA_DIR,
    defaultViewport: { width: 1280, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

    process.stderr.write(`[xhs-images] 导航: ${noteUrl}\n`);
    await page.goto(noteUrl, { waitUntil: "networkidle2", timeout: 30_000 });

    // 等待页面完全渲染（React hydration）
    await sleep(2500);

    // 从 __INITIAL_STATE__ 提取图片列表
    const imageUrls = await page.evaluate(() => {
      const state = (window as unknown as Record<string, unknown>).__INITIAL_STATE__;
      if (!state || typeof state !== "object") return [] as string[];

      const urls: string[] = [];

      function normalizeUrl(raw: string): string {
        if (!raw) return "";
        return raw.startsWith("//") ? `https:${raw}` : raw;
      }

      function extractFromImageItem(img: Record<string, unknown>): string {
        const infoList = (img.info_list as Array<{ image_scene?: string; url?: string }>) ?? [];
        const best =
          infoList.find((i) => i.image_scene === "WB_DFT")?.url ??
          infoList[0]?.url ??
          (img.url_default as string) ??
          (img.url as string) ??
          "";
        return best;
      }

      function walk(obj: unknown, depth: number): void {
        if (depth > 10 || !obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          // 判断是否为 image_list（每项都有 url_default 或 info_list）
          const looksLikeImageList =
            obj.length > 0 &&
            obj.every(
              (item) =>
                item &&
                typeof item === "object" &&
                ("url_default" in item || "info_list" in item)
            );
          if (looksLikeImageList) {
            for (const img of obj as Record<string, unknown>[]) {
              const u = normalizeUrl(extractFromImageItem(img));
              if (u) urls.push(u);
            }
            return;
          }
          for (const item of obj) walk(item, depth + 1);
        } else {
          for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
            // image_list 是我们要找的键名
            if (key === "imageList" || key === "image_list") {
              walk(val, depth + 1);
            } else {
              walk(val, depth + 1);
            }
          }
        }
      }

      walk(state, 0);
      return urls;
    });

    process.stderr.write(`[xhs-images] 从 __INITIAL_STATE__ 提取到 ${imageUrls.length} 张图片\n`);

    if (imageUrls.length === 0) {
      // 保存页面 HTML 供调试
      const html = await page.content();
      const hasState = html.includes("__INITIAL_STATE__");
      process.stderr.write(`[xhs-images] __INITIAL_STATE__ 存在: ${hasState}，页面长度: ${html.length}\n`);
      throw new Error("笔记页面未找到图片（可能需要重新登录）");
    }

    return imageUrls;
  } finally {
    await browser.close().catch(() => { /**/ });
  }
}

(async () => {
  const noteUrl = process.argv[2];
  if (!noteUrl) {
    process.stdout.write(JSON.stringify({ ok: false, error: "缺少笔记 URL 参数" }));
    process.exit(1);
  }
  try {
    const imageUrls = await fetchNoteImages(noteUrl);
    process.stdout.write(JSON.stringify({ ok: true, imageUrls }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({ ok: false, error: message }));
    process.exit(1);
  }
})();
