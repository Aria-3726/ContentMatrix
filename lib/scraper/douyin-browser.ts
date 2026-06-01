/**
 * 抖音搜索 — Puppeteer 浏览器方案（主力）
 *
 * 架构：
 *   Next.js API route → searchDouyinBrowser() → 子进程 scripts/douyin-search.ts
 *                                                  → puppeteer Chrome（隔离进程）
 *                                                  → 拦截 XHR 输出 JSON
 *
 * 原理：抖音搜索 API 需要 `a_bogus` 签名（浏览器端 JS 动态计算，不可伪造）。
 *   让真实 Chrome 打开搜索页，抖音自己的 JS 生成签名，拦截 XHR 响应获取视频列表。
 *
 * 前置条件：
 *   运行 `npx tsx scripts/douyin-login.ts` 完成一次性登录。
 *   Session 保存到 .browser-data/douyin/，有效期约 30 天。
 */

import { execFile } from "child_process";
import path from "path";
import fs from "fs";
import type { ScraperResult } from "@/lib/db/types";

export const DOUYIN_BROWSER_DATA_DIR = path.join(
  process.cwd(),
  ".browser-data",
  "douyin"
);

// ── 公共类型 ──────────────────────────────────────────────────

export interface DouyinBrowserSearchOptions {
  keyword: string;
  minViews?: number;
  minDuration?: number; // 秒
  maxDuration?: number; // 秒
  timeoutMs?: number;
}

// ── 会话检查 ──────────────────────────────────────────────────

export function sessionExists(): boolean {
  return fs.existsSync(
    path.join(DOUYIN_BROWSER_DATA_DIR, "Default", "Cookies")
  );
}

export function assertSessionExists(): void {
  if (!sessionExists()) {
    throw new Error(
      "未找到抖音登录会话，请先运行：\n\n" +
        "  npx tsx scripts/douyin-login.ts\n\n" +
        "在打开的浏览器窗口中登录抖音账号，然后关闭窗口。\n" +
        "登录状态会保存到 .browser-data/douyin/，后续搜索自动使用。"
    );
  }
}

// ── 系统 Chrome 路径检测 ──────────────────────────────────────

export function findChromePath(): string | undefined {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => fs.existsSync(p));
}

// ── 主导出：通过子进程调用 scripts/douyin-search.ts ──────────

/**
 * 搜索抖音视频（通过子进程隔离 Chrome，避免与 Next.js 进程冲突）。
 * 需要提前运行 `npx tsx scripts/douyin-login.ts` 完成登录。
 */
export async function searchDouyinBrowser(
  opts: DouyinBrowserSearchOptions
): Promise<ScraperResult[]> {
  assertSessionExists();

  // 找 tsx 可执行文件（优先项目本地安装）
  const tsxBin =
    path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const scriptPath = path.join(process.cwd(), "scripts", "douyin-search.ts");

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      tsxBin,
      [scriptPath, JSON.stringify(opts)],
      {
        timeout: (opts.timeoutMs ?? 35_000) + 10_000, // 给子进程多 10s 启动时间
        maxBuffer: 5 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`,
        },
      },
      (err, out, stderr) => {
        if (err) {
          const msg = stderr?.trim() || err.message;
          reject(new Error(`[douyin-search] 子进程失败: ${msg.split("\n")[0]}`));
        } else {
          resolve(out);
        }
      }
    );
    child.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
  });

  let parsed: { ok: true; data: ScraperResult[] } | { ok: false; error: string };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`[douyin-search] 子进程输出解析失败: ${stdout.slice(0, 200)}`);
  }

  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.data;
}
