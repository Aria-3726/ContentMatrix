/**
 * GET /api/auth/tiktok/start
 * Initiates TikTok OAuth 2.0 PKCE flow.
 * Stores the code_verifier in a cookie, then redirects to TikTok.
 */

import { NextResponse } from "next/server";
import crypto from "crypto";

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY ?? "";
const REDIRECT_URI = "https://content-matrix-sigma.vercel.app/auth/tiktok/callback";
const SCOPES = ["user.info.basic", "video.publish", "video.upload"];

function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString("base64url").slice(0, 128);
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export async function GET() {
  if (!CLIENT_KEY) {
    return NextResponse.json(
      { error: "TIKTOK_CLIENT_KEY not set in environment" },
      { status: 500 }
    );
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_key: CLIENT_KEY,
    scope: SCOPES.join(","),
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    state: "contentmatrix",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authUrl = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;

  const response = NextResponse.redirect(authUrl);

  // Store code_verifier in a short-lived httpOnly cookie
  response.cookies.set("tiktok_cv", codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return response;
}
