/**
 * GET /api/tiktok/creator-info
 * Proxy for TikTok's creator_info/query endpoint.
 * Returns creator nickname, avatar, available privacy levels, and interaction flags.
 */

import { NextResponse } from "next/server";

const API_BASE = "https://open.tiktokapis.com/v2";

export interface TikTokCreatorInfo {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

async function getAccessToken(): Promise<string> {
  let token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) throw new Error("No TIKTOK_ACCESS_TOKEN set");
  return token;
}

export async function GET() {
  try {
    const token = await getAccessToken();

    const resp = await fetch(`${API_BASE}/post/publish/creator_info/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({}),
    });

    const raw = (await resp.json()) as {
      data?: TikTokCreatorInfo;
      error?: { code?: string; message?: string };
    };

    if (raw.error?.code && raw.error.code !== "ok") {
      return NextResponse.json(
        { error: `${raw.error.code}: ${raw.error.message}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ data: raw.data ?? {} });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
