/**
 * One-time YouTube OAuth2 setup script.
 * Run: npx tsx scripts/youtube-auth.ts
 *
 * Opens browser → user authorizes → local server captures the code →
 * prints YOUTUBE_REFRESH_TOKEN for .env
 */

import "dotenv/config";
import { google } from "googleapis";
import http from "http";
import { execSync } from "child_process";

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET ?? "";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in your .env first."
  );
  process.exit(1);
}

const PORT = 9004;
const REDIRECT_URI = `http://localhost:${PORT}`;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl", // Required for captions API
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");

  if (!code) {
    res.writeHead(400);
    res.end("Missing code parameter");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>✅ 授权成功！可以关闭此页面。</h1>");

    console.log("\n✅ 授权成功！请将以下内容添加到 .env：\n");
    console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (err) {
    res.writeHead(500);
    res.end("Token exchange failed");
    console.error("Token exchange failed:", err);
  }

  server.close();
});

server.listen(PORT, () => {
  console.log(`\n正在打开浏览器进行授权...\n`);
  console.log(`如果浏览器没有自动打开，请手动访问：\n${authUrl}\n`);
  try {
    execSync(`open "${authUrl}"`);
  } catch {}
});
