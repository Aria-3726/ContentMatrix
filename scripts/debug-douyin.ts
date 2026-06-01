/**
 * 调试脚本：打印抖音 XHR 响应结构，用于确认字段路径
 * 运行: npx tsx scripts/debug-douyin.ts
 */

import puppeteer from "puppeteer";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const DIR = path.join(process.cwd(), ".browser-data", "douyin");

async function main() {
  try { execSync(`pkill -f "${DIR}" 2>/dev/null || true`); } catch { /* ignore */ }
  try { fs.unlinkSync(path.join(DIR, "SingletonLock")); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 500));

  const chromePath = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ].find((p) => fs.existsSync(p));

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    userDataDir: DIR,
    defaultViewport: { width: 1280, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any = null;

  const done = new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 30_000);
    page.on("response", async (resp) => {
      if (!resp.url().includes("/aweme/v1/web/search/item/")) return;
      raw = await resp.json().catch(() => null);
      clearTimeout(timeout);
      resolve();
    });
  });

  await page.goto(
    `https://www.douyin.com/search/${encodeURIComponent("原神")}?type=video`,
    { waitUntil: "domcontentloaded", timeout: 30_000 }
  );
  await page.evaluate(() => window.scrollBy(0, 500));
  await done;
  await browser.close();

  if (!raw) {
    console.log("❌ 未拿到 XHR 数据（超时或未登录）");
    process.exit(1);
  }

  console.log("📦 顶层 keys:", Object.keys(raw).join(", "));

  const list = raw.data ?? raw.aweme_list ?? [];
  console.log(`📋 列表长度: ${list.length}`);

  if (!list.length) {
    console.log("\n原始响应 (前 500 chars):\n", JSON.stringify(raw).slice(0, 500));
    process.exit(0);
  }

  const first = list[0];
  const aweme = first?.aweme_info ?? first;

  console.log("\n第一条 aweme keys:", Object.keys(aweme).join(", "));
  console.log("aweme_id     :", aweme.aweme_id);
  console.log("desc         :", (aweme.desc ?? "").slice(0, 60));
  console.log("statistics   :", JSON.stringify(aweme.statistics));
  console.log("video.dur(ms):", aweme.video?.duration);
  console.log("create_time  :", aweme.create_time);
  console.log("author       :", JSON.stringify(aweme.author));

  console.log("\n✅ 前 3 条视频:");
  for (const item of list.slice(0, 3)) {
    const v = item?.aweme_info ?? item;
    const durSec = Math.floor((v.video?.duration ?? 0) / 1000);
    const views = v.statistics?.play_count ?? 0;
    console.log(`  [${views.toLocaleString()} 播放 | ${durSec}s] ${(v.desc ?? "").slice(0, 50)}`);
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
