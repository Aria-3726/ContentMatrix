/**
 * TikTok publisher — uses the Content Posting API v2 (FILE_UPLOAD method).
 *
 * Flow:
 *   1. POST /v2/post/publish/video/init/  → get publish_id + upload_url
 *   2. PUT chunks to upload_url           → chunked HTTP upload
 *   3. POST /v2/post/publish/status/fetch/ → poll until PUBLISH_COMPLETE
 *
 * Requires:
 *   TIKTOK_ACCESS_TOKEN  — from scripts/tiktok-auth.ts
 *   TIKTOK_REFRESH_TOKEN — from scripts/tiktok-auth.ts
 *   TIKTOK_CLIENT_KEY    — from TikTok Developer Portal
 *   TIKTOK_CLIENT_SECRET — from TikTok Developer Portal
 */

import fs from "fs";

const API_BASE = "https://open.tiktokapis.com/v2";
const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per chunk

// ── Types ────────────────────────────────────────────────────

export interface TikTokUploadOptions {
  videoFilePath: string;
  title: string;
  description?: string;
  tags?: string[];
  /** "PUBLIC_TO_EVERYONE" | "FOLLOWER_OF_CREATOR" | "MUTUAL_FOLLOW_FRIENDS" | "SELF_ONLY" */
  privacyLevel?: string;
  /** Allow viewers to comment. Default false. */
  allowComment?: boolean;
  /** Allow duet. Default false. */
  allowDuet?: boolean;
  /** Allow stitch. Default false. */
  allowStitch?: boolean;
  /** Commercial disclosure: is this branded content? */
  brandedContent?: boolean;
  /** Commercial disclosure: is this your own brand promotion? */
  yourBrand?: boolean;
  /** If true, publishes directly (requires video.publish scope). Defaults to true. */
  directPost?: boolean;
}

export interface TikTokUploadResult {
  publishId: string;
}

// ── Token refresh ────────────────────────────────────────────

async function refreshAccessToken(): Promise<string> {
  const refreshToken = process.env.TIKTOK_REFRESH_TOKEN;
  const useSandbox = process.env.TIKTOK_USE_SANDBOX === "true";
  const clientKey = useSandbox
    ? (process.env.TIKTOK_SANDBOX_CLIENT_KEY ?? process.env.TIKTOK_CLIENT_KEY)
    : process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = useSandbox
    ? (process.env.TIKTOK_SANDBOX_CLIENT_SECRET ?? process.env.TIKTOK_CLIENT_SECRET)
    : process.env.TIKTOK_CLIENT_SECRET;

  if (!refreshToken || !clientKey || !clientSecret) {
    throw new Error(
      "Missing TIKTOK_REFRESH_TOKEN, TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET in .env"
    );
  }

  const resp = await fetch(`${API_BASE}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = (await resp.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!data.access_token) {
    throw new Error(
      `Token refresh failed: ${data.error_description ?? data.error ?? "unknown"}`
    );
  }

  // Update env var in memory for this process
  process.env.TIKTOK_ACCESS_TOKEN = data.access_token;
  console.log("[tiktok] Access token refreshed");
  return data.access_token;
}

async function getAccessToken(): Promise<string> {
  let token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) {
    console.log("[tiktok] No access token — attempting refresh...");
    token = await refreshAccessToken();
  }
  return token;
}

// ── API helpers ──────────────────────────────────────────────

async function apiPost<T>(
  path: string,
  body: unknown,
  token: string
): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });

  const data = (await resp.json()) as { data?: T; error?: { code?: string; message?: string; log_id?: string } };

  if (data.error?.code && data.error.code !== "ok") {
    throw new Error(
      `TikTok API error [${data.error.code}]: ${data.error.message ?? ""} (log_id: ${data.error.log_id ?? ""})`
    );
  }

  return data.data as T;
}

// ── Upload chunks ────────────────────────────────────────────

async function uploadChunks(
  uploadUrl: string,
  filePath: string,
  fileSize: number,
  chunkSize: number = CHUNK_SIZE
): Promise<void> {
  const totalChunks = Math.ceil(fileSize / chunkSize);
  const fd = fs.openSync(filePath, "r");

  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, fileSize) - 1;
      const thisChunkBytes = end - start + 1;

      const buffer = Buffer.alloc(thisChunkBytes);
      fs.readSync(fd, buffer, 0, thisChunkBytes, start);

      console.log(
        `[tiktok] Uploading chunk ${i + 1}/${totalChunks} (${(thisChunkBytes / 1024 / 1024).toFixed(1)} MB)...`
      );

      const putResp = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Content-Type": "video/mp4",
          "Content-Length": String(thisChunkBytes),
        },
        body: buffer,
      });

      if (!putResp.ok) {
        const text = await putResp.text().catch(() => "");
        throw new Error(
          `Chunk ${i + 1} upload failed (${putResp.status}): ${text}`
        );
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

// ── Poll publish status ──────────────────────────────────────

async function pollPublishStatus(
  publishId: string,
  token: string
): Promise<void> {
  const maxAttempts = 60;
  const delayMs = 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, delayMs));

    const status = await apiPost<{
      status?: string;
      fail_reason?: string;
      publicly_available_post_id?: string[];
    }>(
      "/post/publish/status/fetch/",
      { publish_id: publishId },
      token
    );

    console.log(`[tiktok] Status (${attempt}/${maxAttempts}): ${status.status}`);

    if (status.status === "PUBLISH_COMPLETE") {
      console.log("[tiktok] Published successfully!");
      return;
    }

    if (
      status.status === "FAILED" ||
      status.status === "PUBLISH_FAILED"
    ) {
      throw new Error(
        `TikTok publish failed: ${status.fail_reason ?? "unknown reason"}`
      );
    }

    // PROCESSING_UPLOAD, PROCESSING_DOWNLOAD, SENDING_TO_USER_INBOX, etc. → keep polling
  }

  console.warn(
    "[tiktok] Timed out polling publish status — check TikTok manually"
  );
}

// ── Main export ──────────────────────────────────────────────

/**
 * Upload a video to TikTok using the Content Posting API v2.
 *
 * Requires a valid TIKTOK_ACCESS_TOKEN (or TIKTOK_REFRESH_TOKEN to auto-refresh).
 * Run `npx tsx scripts/tiktok-auth.ts` to obtain tokens.
 */
export async function uploadToTikTok(
  opts: TikTokUploadOptions
): Promise<TikTokUploadResult> {
  if (!fs.existsSync(opts.videoFilePath)) {
    throw new Error(`Video file not found: ${opts.videoFilePath}`);
  }

  const fileSize = fs.statSync(opts.videoFilePath).size;
  console.log(
    `[tiktok] Uploading ${(fileSize / 1024 / 1024).toFixed(1)} MB to TikTok...`
  );

  const token = await getAccessToken();
  // TikTok requires chunk_size == video_size when the file fits in one chunk
  const effectiveChunkSize = fileSize <= CHUNK_SIZE ? fileSize : CHUNK_SIZE;
  const totalChunks = Math.ceil(fileSize / effectiveChunkSize);

  // Build caption (title + description + hashtags)
  let caption = opts.title;
  if (opts.description) caption += "\n\n" + opts.description;
  if (opts.tags?.length) {
    caption += " " + opts.tags.map((t) => `#${t}`).join(" ");
  }
  caption = caption.slice(0, 2200);

  const directPost = opts.directPost !== false; // default true

  // ── Step 0: Query creator info (required by TikTok) ──────
  console.log("[tiktok] Querying creator info...");
  let privacyLevel = opts.privacyLevel ?? "SELF_ONLY";
  try {
    const creatorInfo = await apiPost<{
      creator_avatar_url?: string;
      creator_username?: string;
      creator_nickname?: string;
      privacy_level_options?: string[];
      comment_disabled?: boolean;
      duet_disabled?: boolean;
      stitch_disabled?: boolean;
      max_video_post_duration_sec?: number;
    }>("/post/publish/creator_info/query/", {}, token);
    console.log("[tiktok] Creator info:", JSON.stringify(creatorInfo));
    // Use first available privacy level option (prefer SELF_ONLY)
    if (creatorInfo.privacy_level_options?.length) {
      if (!creatorInfo.privacy_level_options.includes(privacyLevel)) {
        privacyLevel = creatorInfo.privacy_level_options[0];
        console.log(`[tiktok] privacy_level adjusted to: ${privacyLevel}`);
      }
    }
  } catch (err) {
    console.warn("[tiktok] creator_info query failed:", err instanceof Error ? err.message : err);
    // non-fatal — proceed with default privacy level
  }

  // ── Step 1: Initialize upload ────────────────────────────
  console.log("[tiktok] Initializing upload...");

  const initResp = await apiPost<{ publish_id: string; upload_url: string }>(
    "/post/publish/video/init/",
    {
      post_info: {
        title: caption,
        privacy_level: privacyLevel,
        disable_comment: !(opts.allowComment ?? false),
        disable_duet: !(opts.allowDuet ?? false),
        disable_stitch: !(opts.allowStitch ?? false),
        video_cover_timestamp_ms: 1000,
        ...(opts.brandedContent || opts.yourBrand
          ? {
              brand_content_toggle: opts.brandedContent ?? false,
              brand_organic_toggle: opts.yourBrand ?? false,
            }
          : {}),
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: fileSize,
        chunk_size: effectiveChunkSize,
        total_chunk_count: totalChunks,
      },
      ...(directPost ? { post_mode: "DIRECT_POST" } : {}),
    },
    token
  );

  const { publish_id: publishId, upload_url: uploadUrl } = initResp;
  console.log(`[tiktok] publish_id: ${publishId}`);

  // ── Step 2: Upload video chunks ──────────────────────────
  await uploadChunks(uploadUrl, opts.videoFilePath, fileSize, effectiveChunkSize);
  console.log("[tiktok] All chunks uploaded, waiting for processing...");

  // ── Step 3: Poll for completion ──────────────────────────
  await pollPublishStatus(publishId, token);

  return { publishId };
}
