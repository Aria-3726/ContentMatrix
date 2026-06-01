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

  console.log("\n=== 抖音登录 ===\n");
  console.log("正在打开浏览器，请稍候...\n");

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

  // 隐藏自动化特征，避免触发人机验证
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  await page.goto("https://www.douyin.com/", {
    waitUntil: "networkidle2",
    timeout: 30_000,
  });

  // 检查是否已登录（简单检查 cookie 中的 sessionid）
  const cookies = await page.cookies("https://www.douyin.com");
  const isLoggedIn = cookies.some(
    (c) => c.name === "sessionid" || c.name === "odin_tt"
  );

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
