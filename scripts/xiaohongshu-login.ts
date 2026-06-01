/**
 * 小红书登录助手 — 打开真实浏览器，手动登录小红书账号。
 * 登录状态保存到 .browser-data/xiaohongshu/，供后续搜索复用。
 *
 * ⚠️  请用专用小号登录，不要使用主创作者账号。
 *
 * 运行方式：
 *   npx tsx scripts/xiaohongshu-login.ts
 *
 * 登录成功后关闭浏览器窗口或按 Ctrl+C 退出。
 * Session 有效期约 30 天，过期后重新运行此脚本。
 */

import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

puppeteerExtra.use(StealthPlugin());

const USER_DATA_DIR = path.join(process.cwd(), ".browser-data", "xiaohongshu");

function findChromePath(): string | undefined {
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ].find((p) => fs.existsSync(p));
}

function cleanupStaleLock(): void {
  const lockFile = path.join(USER_DATA_DIR, "SingletonLock");
  if (!fs.existsSync(lockFile)) return;
  console.log("清理旧的浏览器锁文件...");
  try { execSync(`pkill -f "${USER_DATA_DIR}" 2>/dev/null || true`); } catch { /**/ }
  try { fs.unlinkSync(lockFile); } catch { /**/ }
}

async function main() {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  cleanupStaleLock();

  const chromePath = findChromePath();
  if (chromePath) {
    console.log(`\n使用系统 Chrome: ${chromePath}`);
  } else {
    console.log("\n未找到系统 Chrome，使用内置 Chromium（可能遇到网络问题）");
  }

  console.log("\n=== 小红书登录 ===");
  console.log("⚠️  请使用专用小号，不要用主账号！\n");
  console.log("正在打开浏览器，请稍候...\n");

  const browser = await puppeteerExtra.launch({
    headless: false,
    executablePath: chromePath,
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  const page = await browser.newPage();

  try {
    await page.goto("https://www.xiaohongshu.com/", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
  } catch (err) {
    console.warn(
      "⚠️  自动跳转失败，请在浏览器地址栏手动输入：https://www.xiaohongshu.com/\n" +
      `   错误: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  // 检查是否已登录
  let isLoggedIn = false;
  try {
    const cookies = await page.cookies("https://www.xiaohongshu.com");
    isLoggedIn = cookies.some((c) =>
      c.name === "web_session" || c.name === "access-token" || c.name === "customer-app-token"
    );
  } catch { /**/ }

  if (isLoggedIn) {
    console.log("✅ 已登录！小红书会话有效。\n");
    console.log("你可以关闭浏览器窗口或按 Ctrl+C 退出。\n");
  } else {
    console.log("🔐 请在浏览器中登录你的小红书账号（建议使用专用小号）：\n");
    console.log("   支持的登录方式：");
    console.log("   - 手机号 + 验证码");
    console.log("   - 微信扫码");
    console.log("   - 微博/QQ 等第三方登录\n");
    console.log("   登录成功后请关闭浏览器窗口，或按 Ctrl+C 退出。\n");
  }

  await new Promise<void>((resolve) => {
    browser.on("disconnected", resolve);
    process.on("SIGINT", async () => {
      console.log("\n正在保存会话...");
      await browser.close().catch(() => { /**/ });
      resolve();
    });
  });

  console.log("✅ 登录会话已保存到 .browser-data/xiaohongshu/");
  console.log("   后续搜索将自动使用此会话。\n");
}

main().catch((err) => {
  console.error("❌ 出错:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
