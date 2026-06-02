/**
 * 小红书笔记图片 URL 提取子进程
 *
 * argv[2] = 笔记 URL (含 xsec_token)
 * stdout  = { ok: true, imageUrls: string[] } | { ok: false, error: string }
 *
 * 原理：Puppeteer 打开笔记页，等待渲染完成后取 page.content()，
 * 在 Node.js 端解析 window.__INITIAL_STATE__ 提取图片列表。
 * 避免在 page.evaluate() 里定义函数（esbuild __name 兼容问题）。
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

/** 从 __INITIAL_STATE__ 字符串解析图片 URL 列表 */
function parseImageUrlsFromState(stateStr: string): string[] {
  const cleaned = stateStr.replace(/\bundefined\b/g, "null");
  let state: unknown;
  try {
    state = JSON.parse(cleaned);
  } catch {
    return [];
  }

  const urls: string[] = [];

  function normalizeUrl(raw: string): string {
    if (!raw) return "";
    return raw.startsWith("//") ? `https:${raw}` : raw;
  }

  function extractFromImg(img: Record<string, unknown>): string {
    // 支持驼峰（infoList/imageScene/urlDefault）和下划线（info_list/image_scene/url_default）
    const infoList = (
      (img.infoList ?? img.info_list) as Array<{ imageScene?: string; image_scene?: string; url?: string }>
    ) ?? [];
    const best =
      infoList.find((i) => (i.imageScene ?? i.image_scene) === "WB_DFT")?.url ??
      infoList[0]?.url ??
      (img.urlDefault as string) ??
      (img.url_default as string) ??
      (img.urlPre as string) ??
      (img.url_pre as string) ??
      "";
    return normalizeUrl(best);
  }

  function isImageItem(item: unknown): item is Record<string, unknown> {
    if (!item || typeof item !== "object") return false;
    const o = item as Record<string, unknown>;
    return (
      "urlDefault" in o || "url_default" in o ||
      "infoList" in o || "info_list" in o
    );
  }

  function walk(obj: unknown, depth: number): void {
    if (depth > 10 || !obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      if (obj.length > 0 && obj.every(isImageItem)) {
        for (const img of obj as Record<string, unknown>[]) {
          const u = extractFromImg(img);
          if (u) urls.push(u);
        }
        return;
      }
      for (const item of obj) walk(item, depth + 1);
    } else {
      for (const val of Object.values(obj as Record<string, unknown>)) {
        walk(val, depth + 1);
      }
    }
  }

  walk(state, 0);
  return urls;
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

    // 同时拦截 XHR（部分笔记图片在 XHR 里而非 SSR state）
    const xhrImageUrls: string[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/api/sns/web/v1/feed") || url.includes("/api/sns/web/v1/note/")) {
        try {
          const json = (await response.json()) as Record<string, unknown>;
          const found = parseImageUrlsFromState(JSON.stringify(json));
          if (found.length > 0) {
            xhrImageUrls.push(...found);
            process.stderr.write(`[xhs-images] XHR 捕获 ${found.length} 张图片\n`);
          }
        } catch { /**/ }
      }
    });

    process.stderr.write(`[xhs-images] 导航: ${noteUrl}\n`);
    await page.goto(noteUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(3500); // 等待 React hydration 和 XHR 响应

    // 优先用 XHR 结果（更完整），否则从 __INITIAL_STATE__ 提取
    if (xhrImageUrls.length > 0) {
      process.stderr.write(`[xhs-images] 使用 XHR 结果：${xhrImageUrls.length} 张\n`);
      return xhrImageUrls;
    }

    // 从页面 HTML 解析 __INITIAL_STATE__
    const html = await page.content();
    const marker = "window.__INITIAL_STATE__=";
    const idx = html.indexOf(marker);

    if (idx === -1) {
      process.stderr.write(`[xhs-images] 未找到 __INITIAL_STATE__，页面长度: ${html.length}\n`);
      throw new Error("笔记页面未找到状态数据（可能需要重新登录）");
    }

    const start = idx + marker.length;
    const scriptEnd = html.indexOf("</script>", start);
    const stateStr = html.slice(start, scriptEnd === -1 ? start + 200_000 : scriptEnd).replace(/;\s*$/, "").trim();

    const imageUrls = parseImageUrlsFromState(stateStr);
    process.stderr.write(`[xhs-images] __INITIAL_STATE__ 提取到 ${imageUrls.length} 张图片\n`);

    if (imageUrls.length === 0) {
      throw new Error("笔记中未找到图片（笔记可能已删除或需要重新登录）");
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
