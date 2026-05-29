/**
 * TikTok OAuth2 setup script (manual code exchange).
 * Run: npx tsx scripts/tiktok-auth.ts
 *
 * Since TikTok requires HTTPS redirect URIs, this script uses a manual flow:
 *   1. Opens the auth URL in browser
 *   2. After user authorizes, TikTok redirects to the redirect URI with ?code=...
 *   3. The page will fail to load (expected) — user copies the code from URL bar
 *   4. Paste the code into the terminal
 *   5. Script exchanges the code for tokens
 *
 * Prerequisites:
 *   1. Create an app at https://developers.tiktok.com/
 *   2. Request "Content Posting API" scopes
 *   3. Set redirect URI to: https://localhost/callback
 *   4. Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env
 */

import "dotenv/config";
import crypto from "crypto";
import { execSync } from "child_process";
import readline from "readline";

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY ?? "";
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET ?? "";

if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error(
    "Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in your .env first.\n" +
      "Get them from https://developers.tiktok.com/ → Your App → Keys"
  );
  process.exit(1);
}

// This must match what you set in TikTok Developer Portal
const REDIRECT_URI = "https://content-matrix-sigma.vercel.app/auth/tiktok/callback";

const SCOPES = ["user.info.basic", "video.publish", "video.upload"];

// ── PKCE ─────────────────────────────────────────────────────
function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString("base64url").slice(0, 128);
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

const codeVerifier = generateCodeVerifier();
const codeChallenge = generateCodeChallenge(codeVerifier);

// ── Build auth URL ───────────────────────────────────────────
const authParams = new URLSearchParams({
  client_key: CLIENT_KEY,
  scope: SCOPES.join(","),
  response_type: "code",
  redirect_uri: REDIRECT_URI,
  state: "contentmatrix",
  code_challenge: codeChallenge,
  code_challenge_method: "S256",
});

const authUrl = `https://www.tiktok.com/v2/auth/authorize/?${authParams.toString()}`;

// ── Main ─────────────────────────────────────────────────────

console.log("\n=== TikTok OAuth2 授权 ===\n");
console.log("1. 打开以下链接并完成授权：\n");
console.log(authUrl);
console.log("\n2. 授权后浏览器会跳转到一个无法打开的页面（正常）");
console.log("3. 从浏览器地址栏复制完整的 URL");
console.log("   它看起来像：https://localhost/callback?code=XXXXX&...\n");

try {
  execSync(`open "${authUrl}"`);
} catch {
  // Non-fatal
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("请粘贴完整的回调 URL（或只粘贴 code 值）：", async (input) => {
  rl.close();

  let code = input.trim();

  // Extract code from URL if full URL was pasted
  if (code.includes("code=")) {
    try {
      const url = new URL(code);
      code = url.searchParams.get("code") ?? code;
    } catch {
      // Try regex fallback
      const match = code.match(/code=([^&]+)/);
      if (match) code = match[1];
    }
  }

  if (!code) {
    console.error("❌ 未提供 code");
    process.exit(1);
  }

  console.log(`\n正在用 code 交换 token...`);

  try {
    const tokenResp = await fetch(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: CLIENT_KEY,
          client_secret: CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier,
        }),
      }
    );

    const data = (await tokenResp.json()) as {
      access_token?: string;
      refresh_token?: string;
      open_id?: string;
      expires_in?: number;
      refresh_expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (data.error || !data.access_token) {
      console.error(
        `\n❌ Token 交换失败: ${data.error_description ?? data.error ?? "Unknown"}`
      );
      process.exit(1);
    }

    console.log("\n✅ TikTok 授权成功！请将以下内容添加到 .env：\n");
    console.log(`TIKTOK_ACCESS_TOKEN=${data.access_token}`);
    console.log(`TIKTOK_REFRESH_TOKEN=${data.refresh_token}`);
    console.log(`TIKTOK_OPEN_ID=${data.open_id}`);
    console.log(`\nAccess token expires in: ${data.expires_in}s`);
    console.log(`Refresh token expires in: ${data.refresh_expires_in}s`);
    console.log(`Granted scopes: ${data.scope}\n`);
  } catch (err) {
    console.error("❌ 请求失败:", err);
    process.exit(1);
  }
});
