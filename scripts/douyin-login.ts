/**
 * 抖音登录助手 — 打开真实浏览器，手动登录抖音账号。
 * 登录状态保存到 .browser-data/douyin/，供后续搜索复用。
 *
 * 运行方式：
 *   npx tsx scripts/douyin-login.ts
 *
 * 登录成功后关闭浏览器窗口或按 Ctrl+C 退出。
 * 后续搜索会自动使用已保存的登录状态，无需重复登录。
 *
 * 注意：登录状态通常有效 30 天左右，过期后重新运行此脚本。
 */

import puppeteer from "puppeteer";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const USER_DATA_DIR = path.join(process.cwd(), ".browser-data", "douyin");

/** 优先使用系统 Chrome，内置 Chromium 在 macOS 上对部分站点有网络兼容问题 */
function findChromePath(): string | undefined {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function cleanupStaleLock(): void {
  const lockFile = path.join(USER_DATA_DIR, "SingletonLock");
  if (!fs.existsSync(lockFile)) return;
  console.log("清理旧的浏览器锁文件...");
  try { execSync(`pkill -f "${USER_DATA_DIR}" 2>/dev/null || true`); } catch { /* ignore */ }
  try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
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

  console.log("\n=== 抖音登录 ===\n");
  console.log("正在打开浏览器，请稍候...\n");

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: chromePath,   // undefined → 使用内置 Chromium
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,        // 使用系统窗口默认尺寸（更自然）
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = await browser.newPage();

  // 隐藏自动化特征，避免触发人机验证
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  // 导航到抖音首页（非致命错误，用户可以手动输入 URL）
  try {
    await page.goto("https://www.douyin.com/", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
  } catch (err) {
    console.warn(
      "⚠️  自动跳转失败，请在浏览器地址栏手动输入：https://www.douyin.com/\n" +
      `   错误详情：${err instanceof Error ? err.message : String(err)}\n`
    );
    // 不退出 —— 浏览器窗口仍然打开，用户可以手动操作
  }

  // 检查是否已登录
  let isLoggedIn = false;
  try {
    const cookies = await page.cookies("https://www.douyin.com");
    isLoggedIn = cookies.some((c) => c.name === "sessionid" || c.name === "odin_tt");
  } catch { /* ignore */ }

  if (isLoggedIn) {
    console.log("✅ 已登录！抖音会话有效。\n");
    console.log("你可以关闭浏览器窗口或按 Ctrl+C 退出。\n");
  } else {
    console.log("🔐 请在浏览器中登录你的抖音账号：\n");
    console.log("   支持的登录方式：");
    console.log("   - 手机号 + 验证码");
    console.log("   - 账号密码");
    console.log("   - 扫码登录\n");
    console.log("   登录成功后请关闭浏览器窗口，或按 Ctrl+C 退出。\n");
  }

  // 等待用户关闭浏览器或按 Ctrl+C
  await new Promise<void>((resolve) => {
    browser.on("disconnected", resolve);
    process.on("SIGINT", async () => {
      console.log("\n正在保存会话并关闭浏览器...");
      await browser.close().catch(() => { /* ignore */ });
      resolve();
    });
  });

  console.log("✅ 登录会话已保存到 .browser-data/douyin/");
  console.log("   后续抖音搜索将自动使用此会话，无需再次登录。\n");
}

main().catch((err) => {
  console.error("❌ 出错:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
