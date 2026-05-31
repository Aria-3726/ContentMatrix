/**
 * GET /api/auth/tiktok/start
 * Initiates TikTok OAuth 2.0 PKCE flow.
 * Stores the code_verifier in a cookie, then redirects to TikTok.
 *
 * Sandbox mode: set TIKTOK_USE_SANDBOX=true in env to use sandbox credentials
 * and a reduced scope set (user.info.profile only).
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const USE_SANDBOX = process.env.TIKTOK_USE_SANDBOX === "true";
const CLIENT_KEY = USE_SANDBOX
  ? (process.env.TIKTOK_SANDBOX_CLIENT_KEY ?? "")
  : (process.env.TIKTOK_CLIENT_KEY ?? "");
const REDIRECT_URI = "https://content-matrix-sigma.vercel.app/auth/tiktok/callback";
const SCOPES = USE_SANDBOX
  ? ["user.info.profile"]
  : ["user.info.basic", "video.publish", "video.upload"];

function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString("base64url").slice(0, 128);
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export async function GET(req: NextRequest) {
  if (!CLIENT_KEY) {
    return NextResponse.json(
      { error: "TIKTOK_CLIENT_KEY not set in environment" },
      { status: 500 }
    );
  }

  // Prefer a client-supplied code_challenge (from client-side PKCE generation).
  // Fall back to server-side generation if not provided.
  const url = new URL(req.url);
  const clientChallenge = url.searchParams.get("code_challenge");

  let codeChallenge: string;
  let codeVerifier: string | null = null;

  if (clientChallenge) {
    // Client generated the PKCE pair and stored the verifier in sessionStorage.
    codeChallenge = clientChallenge;
  } else {
    // Fallback: server-side generation + cookie (legacy path).
    codeVerifier = generateCodeVerifier();
    codeChallenge = generateCodeChallenge(codeVerifier);
  }

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

  // Only set cookie on the legacy server-side path.
  if (codeVerifier) {
    response.cookies.set("tiktok_cv", codeVerifier, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  }

  return response;
}
