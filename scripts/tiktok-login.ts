/**
 * TikTok login helper — opens a browser for the user to log in.
 * The session is saved to .browser-data/tiktok/ for the publisher to reuse.
 *
 * Run: npx tsx scripts/tiktok-login.ts
 *
 * After logging in, close the terminal (Ctrl+C) to exit.
 * The session will persist for future uploads.
 */

import puppeteer from "puppeteer";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const USER_DATA_DIR = path.join(process.cwd(), ".browser-data", "tiktok");

function cleanupStaleLock(): void {
  const lockFile = path.join(USER_DATA_DIR, "SingletonLock");
  if (!fs.existsSync(lockFile)) return;
  console.log("清理旧的浏览器锁文件...");
  try { execSync(`pkill -f "${USER_DATA_DIR}" 2>/dev/null || true`); } catch {}
  try { fs.unlinkSync(lockFile); } catch {}
}

async function main() {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  cleanupStaleLock();

  console.log("\n=== TikTok 登录 ===\n");
  console.log("正在打开浏览器...\n");

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: USER_DATA_DIR,
    defaultViewport: { width: 1280, height: 900 },
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
  });

  // Go to TikTok Studio — this will redirect to login if not logged in
  await page.goto("https://www.tiktok.com/tiktokstudio/upload", {
    waitUntil: "networkidle2",
    timeout: 30_000,
  });

  const url = page.url();
  if (url.includes("/upload") && !url.includes("login")) {
    console.log("✅ 已登录！TikTok 会话有效。\n");
    console.log("你可以关闭浏览器或按 Ctrl+C 退出。");
    console.log("后续发布会自动使用已保存的登录状态。\n");
  } else {
    console.log("🔐 请在浏览器中登录你的 TikTok 账号。\n");
    console.log("   支持以下登录方式：");
    console.log("   - 手机号 + 验证码");
    console.log("   - Email + 密码");
    console.log("   - Google / Apple / Facebook 等第三方登录");
    console.log("   - 扫码登录\n");
    console.log("   登录成功后页面会跳转到 TikTok Studio。");
    console.log("   然后你可以关闭浏览器或按 Ctrl+C 退出。\n");
  }

  // Keep the browser open until the user closes it or hits Ctrl+C
  await new Promise<void>((resolve) => {
    browser.on("disconnected", resolve);
    process.on("SIGINT", async () => {
      console.log("\n正在保存会话并关闭浏览器...");
      await browser.close();
      resolve();
    });
  });

  console.log("✅ 登录会话已保存到 .browser-data/tiktok/");
  console.log("   后续发布将自动使用此会话。\n");
}

main().catch((err) => {
  console.error("❌ 错误:", err.message);
  process.exit(1);
});
