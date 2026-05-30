/**
 * POST /api/auth/tiktok/exchange
 * Exchanges the TikTok authorization code for tokens.
 * Reads the PKCE code_verifier from cookie.
 */

import { NextRequest, NextResponse } from "next/server";

const USE_SANDBOX = process.env.TIKTOK_USE_SANDBOX === "true";
const CLIENT_KEY = USE_SANDBOX
  ? (process.env.TIKTOK_SANDBOX_CLIENT_KEY ?? "")
  : (process.env.TIKTOK_CLIENT_KEY ?? "");
const CLIENT_SECRET = USE_SANDBOX
  ? (process.env.TIKTOK_SANDBOX_CLIENT_SECRET ?? "")
  : (process.env.TIKTOK_CLIENT_SECRET ?? "");
const REDIRECT_URI = "https://content-matrix-sigma.vercel.app/auth/tiktok/callback";

export async function POST(req: NextRequest) {
  const { code } = (await req.json()) as { code?: string };

  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const codeVerifier = req.cookies.get("tiktok_cv")?.value;
  if (!codeVerifier) {
    return NextResponse.json(
      { error: "PKCE code_verifier missing — please restart the auth flow" },
      { status: 400 }
    );
  }

  if (!CLIENT_KEY || !CLIENT_SECRET) {
    return NextResponse.json(
      { error: "TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not configured" },
      { status: 500 }
    );
  }

  const tokenResp = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
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
  });

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
    return NextResponse.json(
      { error: data.error_description ?? data.error ?? "Token exchange failed" },
      { status: 400 }
    );
  }

  // Clear the verifier cookie
  const response = NextResponse.json({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    open_id: data.open_id,
    expires_in: data.expires_in,
    refresh_expires_in: data.refresh_expires_in,
    scope: data.scope,
  });

  response.cookies.set("tiktok_cv", "", { maxAge: 0, path: "/" });

  return response;
}
