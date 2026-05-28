/**
 * One-time TikTok OAuth2 setup script.
 * Run: npx tsx scripts/tiktok-auth.ts
 *
 * Opens browser → user authorizes → local server captures the code →
 * exchanges for access/refresh tokens → prints TIKTOK_REFRESH_TOKEN for .env
 *
 * Prerequisites:
 *   1. Create an app at https://developers.tiktok.com/
 *   2. Request "Content Posting API" (video.publish) scope
 *   3. Set redirect URI to http://localhost:9005/callback
 *   4. Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in .env
 */

import http from "http";
import { execSync } from "child_process";

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY ?? "";
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET ?? "";

if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error(
    "Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in your .env first.\n" +
    "Get them from https://developers.tiktok.com/ → Your App → Keys"
  );
  process.exit(1);
}

const PORT = 9005;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

// TikTok OAuth2 scopes for content posting
const SCOPES = [
  "user.info.basic",
  "video.publish",
  "video.upload",
];

// Build authorization URL
const authParams = new URLSearchParams({
  client_key: CLIENT_KEY,
  scope: SCOPES.join(","),
  response_type: "code",
  redirect_uri: REDIRECT_URI,
  state: "contentmatrix",
});

const authUrl = `https://www.tiktok.com/v2/auth/authorize/?${authParams.toString()}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);

  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>❌ 授权失败</h1><p>${url.searchParams.get("error_description") ?? error}</p>`);
    console.error("Auth error:", error, url.searchParams.get("error_description"));
    server.close();
    return;
  }

  if (!code) {
    res.writeHead(400);
    res.end("Missing code parameter");
    return;
  }

  try {
    // Exchange authorization code for access token
    const tokenResp = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: CLIENT_KEY,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResp.json() as {
      access_token?: string;
      refresh_token?: string;
      open_id?: string;
      expires_in?: number;
      refresh_expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      throw new Error(
        `Token exchange failed: ${tokenData.error_description ?? tokenData.error ?? "Unknown error"}`
      );
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>✅ TikTok 授权成功！可以关闭此页面。</h1>");

    console.log("\n✅ TikTok 授权成功！请将以下内容添加到 .env：\n");
    console.log(`TIKTOK_CLIENT_KEY=${CLIENT_KEY}`);
    console.log(`TIKTOK_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`TIKTOK_ACCESS_TOKEN=${tokenData.access_token}`);
    console.log(`TIKTOK_REFRESH_TOKEN=${tokenData.refresh_token}`);
    console.log(`TIKTOK_OPEN_ID=${tokenData.open_id}`);
    console.log(`\nAccess token expires in: ${tokenData.expires_in}s`);
    console.log(`Refresh token expires in: ${tokenData.refresh_expires_in}s`);
    console.log(`Granted scopes: ${tokenData.scope}\n`);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>❌ Token 交换失败</h1>");
    console.error("Token exchange failed:", err);
  }

  server.close();
});

server.listen(PORT, () => {
  console.log(`\n正在打开浏览器进行 TikTok 授权...\n`);
  console.log(`如果浏览器没有自动打开，请手动访问：\n${authUrl}\n`);
  try {
    execSync(`open "${authUrl}"`);
  } catch {
    // Non-fatal: user can copy URL manually
  }
});
