/**
 * TikTok publisher — connects to the user's running Chrome via remote debugging.
 *
 * Instead of launching a separate browser (which has no TikTok session),
 * this connects to the user's actual Chrome browser where TikTok is already
 * logged in. It opens a new tab, uploads the video, then closes the tab.
 *
 * How it works:
 *   1. Check if Chrome is running with --remote-debugging-port=9222
 *   2. If not, restart Chrome with that flag (restores all tabs)
 *   3. Connect via puppeteer.connect()
 *   4. Open new tab → TikTok Studio → upload → close tab
 *   5. Disconnect (does NOT close Chrome)
 *
 * Prerequisite: Be logged into tiktok.com in Google Chrome.
 */

import puppeteer, { type Browser, type Page } from "puppeteer";
import { execSync } from "child_process";
import fs from "fs";

const UPLOAD_URL = "https://www.tiktok.com/tiktokstudio/upload";
const DEBUG_PORT = 9222;
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;

// ── Types ────────────────────────────────────────────────────

export interface TikTokUploadOptions {
  videoFilePath: string;
  title: string;
  description?: string;
  tags?: string[];
  privacyLevel?: string;
}

export interface TikTokUploadResult {
  publishId: string;
}

// ── Chrome Connection ────────────────────────────────────────

/**
 * Check if Chrome is running with remote debugging enabled.
 */
async function isDebugPortOpen(): Promise<string | null> {
  try {
    const resp = await fetch(`${DEBUG_URL}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    const data = (await resp.json()) as { webSocketDebuggerUrl?: string };
    return data.webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Connect to Chrome via remote debugging.
 * If Chrome doesn't have debugging enabled, configure it for the NEXT launch
 * and ask the user to restart Chrome manually — never auto-quit Chrome.
 */
async function connectToChrome(): Promise<Browser> {
  const wsUrl = await isDebugPortOpen();

  if (wsUrl) {
    console.log("[tiktok] Connected to existing Chrome");
    return puppeteer.connect({
      browserWSEndpoint: wsUrl,
      defaultViewport: null,
    });
  }

  // Chrome doesn't have debugging enabled.
  // Configure it so the NEXT normal Chrome launch will have the port.
  // This is a one-time setup — never auto-quit Chrome.
  try {
    execSync(
      `defaults write com.google.Chrome CommandLineFlags '--remote-debugging-port=${DEBUG_PORT}'`,
      { stdio: "pipe" }
    );
    console.log("[tiktok] Chrome configured for remote debugging on next launch");
  } catch {
    // Ignore if defaults write fails
  }

  throw new Error(
    "需要一次性设置：请手动重启 Chrome（退出再重新打开），之后发布 TikTok 就会全自动了。\n\n" +
    "重启 Chrome 不会丢失标签页（Chrome 会自动恢复）。"
  );
}

// ── Helpers ──────────────────────────────────────────────────

async function waitMs(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (t) => new Promise<void>((r) => setTimeout(r, t)),
    ms
  );
}

// ── Main Export ──────────────────────────────────────────────

/**
 * Upload a video to TikTok using the user's Chrome browser.
 *
 * Connects to Chrome via remote debugging — uses the user's actual
 * TikTok session. No separate login needed.
 */
export async function uploadToTikTok(
  opts: TikTokUploadOptions
): Promise<TikTokUploadResult> {
  if (!fs.existsSync(opts.videoFilePath)) {
    throw new Error(`Video file not found: ${opts.videoFilePath}`);
  }

  const fileSize = fs.statSync(opts.videoFilePath).size;
  console.log(
    `[tiktok] Uploading ${(fileSize / 1024 / 1024).toFixed(1)} MB to TikTok...`
  );

  // Connect to user's Chrome
  const browser = await connectToChrome();
  let page: Page | null = null;

  try {
    // Open a NEW tab (don't touch existing tabs)
    page = await browser.newPage();

    // Navigate to TikTok Studio upload
    console.log("[tiktok] Opening TikTok Studio...");
    await page.goto(UPLOAD_URL, {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });

    // Check login state
    const currentUrl = page.url();
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/passport") ||
      currentUrl.includes("login_redirect")
    ) {
      throw new Error(
        "TikTok 未登录。请先在 Chrome 中登录 tiktok.com 后再试。"
      );
    }

    // ── Upload video ─────────────────────────────────────────
    console.log("[tiktok] Looking for file input...");
    const fileInput = await page.waitForSelector('input[type="file"]', {
      timeout: 15_000,
    });
    if (!fileInput) throw new Error("找不到文件上传输入框");

    await fileInput.uploadFile(opts.videoFilePath);
    console.log("[tiktok] Video selected, uploading...");

    // Wait for caption editor (signals upload complete)
    console.log("[tiktok] Waiting for upload to finish...");
    await page.waitForSelector(
      [
        ".DraftEditor-root",
        '[contenteditable="true"][data-contents]',
        '[data-text="true"]',
        '[contenteditable="true"]',
      ].join(", "),
      { timeout: 600_000 } // 10 min for large files
    );

    console.log("[tiktok] Upload complete, filling caption...");
    await waitMs(page, 3000);

    // ── Fill caption ─────────────────────────────────────────
    let caption = opts.title;
    if (opts.description) caption += "\n\n" + opts.description;
    if (opts.tags?.length) {
      caption += " " + opts.tags.map((t) => `#${t}`).join(" ");
    }
    caption = caption.slice(0, 2200);

    const editor = await page.$(
      [
        ".DraftEditor-root .DraftEditor-editorContainer [contenteditable]",
        '[contenteditable="true"][data-contents]',
        ".caption-editor [contenteditable]",
        '[contenteditable="true"]',
      ].join(", ")
    );

    if (editor) {
      await editor.click();
      await waitMs(page, 500);

      // Select all + delete
      const mod = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.down(mod);
      await page.keyboard.press("a");
      await page.keyboard.up(mod);
      await page.keyboard.press("Backspace");
      await waitMs(page, 300);

      await page.keyboard.type(caption, { delay: 15 });
      console.log("[tiktok] Caption filled");
    } else {
      console.warn("[tiktok] Could not find caption editor");
    }

    await waitMs(page, 2000);

    // ── Click Post ───────────────────────────────────────────
    console.log("[tiktok] Looking for Post button...");

    const clicked = await page.evaluate(() => {
      const btns = Array.from(
        document.querySelectorAll("button, [role='button']")
      );
      for (const label of ["Post", "发布", "Publish"]) {
        const btn = btns.find(
          (b) => b.textContent?.trim().toLowerCase() === label.toLowerCase()
        );
        if (btn) {
          (btn as HTMLElement).click();
          return true;
        }
      }
      // Fallback: try data-e2e selector
      const fallback = document.querySelector(
        'button[data-e2e="post_video_button"]'
      ) as HTMLElement | null;
      if (fallback) {
        fallback.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      throw new Error("找不到发布按钮");
    }

    console.log("[tiktok] Post button clicked, waiting...");

    // Wait for success
    try {
      await page.waitForFunction(
        () => {
          const url = window.location.href;
          if (!url.includes("/upload")) return true;
          const body = document.body.innerText;
          return (
            body.includes("successfully") ||
            body.includes("posted") ||
            body.includes("发布成功")
          );
        },
        { timeout: 60_000 }
      );
      console.log("[tiktok] Published successfully!");
    } catch {
      console.warn(
        "[tiktok] Could not confirm publish — check TikTok manually"
      );
    }

    return { publishId: `chrome-${Date.now()}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tiktok] Upload failed: ${msg}`);
    throw err;
  } finally {
    // Close only our tab, disconnect from Chrome (don't close it!)
    if (page) {
      try {
        await page.close();
      } catch {
        // Tab might already be closed
      }
    }
    browser.disconnect();
  }
}
