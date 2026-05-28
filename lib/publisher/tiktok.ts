/**
 * TikTok Content Posting API publisher (v2 — Direct Post flow).
 *
 * Flow:
 *   1. Query creator info → confirm available privacy levels
 *   2. POST /post/publish/video/init/ with post_info + source_info (FILE_UPLOAD)
 *      → get upload_url + publish_id
 *   3. PUT chunks to upload_url with Content-Range
 *   4. Poll /post/publish/status/fetch/ until PUBLISH_COMPLETE or FAILED
 *
 * Note: TikTok does NOT support separate subtitle/caption file upload.
 *       Subtitles should be burned into the video via FFmpeg before uploading.
 *
 * Setup:
 *   1. Register at https://developers.tiktok.com/
 *   2. Create an app, request "Content Posting API"
 *   3. Run: npx tsx scripts/tiktok-auth.ts
 *   4. Set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_ACCESS_TOKEN,
 *      TIKTOK_REFRESH_TOKEN in .env
 */

import fs from "fs";

const API_BASE = "https://open.tiktokapis.com/v2";

// Maximum chunk size for FILE_UPLOAD mode (64 MB)
const MAX_CHUNK_SIZE = 64 * 1024 * 1024;
// Minimum chunk size (5 MB — TikTok requirement)
const MIN_CHUNK_SIZE = 5 * 1024 * 1024;

// ── Token management ─────────────────────────────────────────

function getTokens() {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  const refreshToken = process.env.TIKTOK_REFRESH_TOKEN;

  if (!accessToken || !refreshToken) {
    throw new Error(
      "TikTok credentials not configured. " +
        "Run: npx tsx scripts/tiktok-auth.ts"
    );
  }

  return { accessToken, refreshToken };
}

/**
 * Refresh the access token (expires every ~24h).
 */
async function refreshAccessToken(): Promise<string> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const { refreshToken } = getTokens();

  if (!clientKey || !clientSecret) {
    throw new Error("TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET required");
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
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (data.error || !data.access_token) {
    throw new Error(
      `TikTok token refresh failed: ${data.error_description ?? data.error}`
    );
  }

  process.env.TIKTOK_ACCESS_TOKEN = data.access_token;
  if (data.refresh_token) {
    process.env.TIKTOK_REFRESH_TOKEN = data.refresh_token;
  }

  return data.access_token;
}

/**
 * Authenticated fetch with auto-refresh on 401.
 */
async function tiktokFetch(
  url: string,
  init: RequestInit = {},
  retried = false
): Promise<Response> {
  let { accessToken } = getTokens();

  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      ...(init.headers as Record<string, string>),
    },
  });

  if (resp.status === 401 && !retried) {
    accessToken = await refreshAccessToken();
    return tiktokFetch(url, init, true);
  }

  return resp;
}

// ── Types ────────────────────────────────────────────────────

type PrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export interface TikTokUploadOptions {
  videoFilePath: string;
  title: string;
  description?: string; // extra text / hashtags
  privacyLevel?: PrivacyLevel;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  videoCoverTimestamp?: number; // seconds
}

export interface TikTokUploadResult {
  publishId: string;
}

interface TikTokApiResponse<T = Record<string, unknown>> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

// ── Helpers ──────────────────────────────────────────────────

function assertOk(data: TikTokApiResponse, context: string): void {
  if (data.error?.code && data.error.code !== "ok") {
    throw new Error(
      `TikTok ${context} failed: ${data.error.message ?? "unknown"} (${data.error.code})`
    );
  }
}

// ── Step 0: Query creator info ───────────────────────────────

export async function queryCreatorInfo(): Promise<{
  username: string;
  privacyOptions: PrivacyLevel[];
  maxDurationSec: number;
}> {
  const resp = await tiktokFetch(
    `${API_BASE}/post/publish/creator_info/query/`,
    { method: "POST", body: JSON.stringify({}) }
  );

  const json = (await resp.json()) as TikTokApiResponse<{
    creator_username?: string;
    privacy_level_options?: PrivacyLevel[];
    max_video_post_duration_sec?: number;
  }>;

  assertOk(json, "creator info query");

  return {
    username: json.data?.creator_username ?? "",
    privacyOptions: json.data?.privacy_level_options ?? ["SELF_ONLY"],
    maxDurationSec: json.data?.max_video_post_duration_sec ?? 600,
  };
}

// ── Step 1: Init upload + create post ────────────────────────

async function initDirectPost(
  opts: TikTokUploadOptions,
  fileSize: number
): Promise<{ uploadUrl: string; publishId: string }> {
  // Determine chunk size: use single chunk if file < 64MB, else multi-chunk
  const chunkSize = fileSize <= MAX_CHUNK_SIZE ? fileSize : MAX_CHUNK_SIZE;
  const totalChunks = Math.ceil(fileSize / chunkSize);

  // TikTok title max 150 chars
  const title = opts.title.slice(0, 150);

  const body = {
    post_info: {
      title,
      privacy_level: opts.privacyLevel ?? "SELF_ONLY",
      disable_comment: opts.disableComment ?? false,
      disable_duet: opts.disableDuet ?? false,
      disable_stitch: opts.disableStitch ?? false,
      video_cover_timestamp_ms: (opts.videoCoverTimestamp ?? 1) * 1000,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: fileSize,
      chunk_size: chunkSize,
      total_chunk_count: totalChunks,
    },
  };

  const resp = await tiktokFetch(
    `${API_BASE}/post/publish/video/init/`,
    { method: "POST", body: JSON.stringify(body) }
  );

  const json = (await resp.json()) as TikTokApiResponse<{
    upload_url?: string;
    publish_id?: string;
  }>;

  assertOk(json, "upload init");

  if (!json.data?.upload_url || !json.data?.publish_id) {
    throw new Error("TikTok init returned no upload_url or publish_id");
  }

  return {
    uploadUrl: json.data.upload_url,
    publishId: json.data.publish_id,
  };
}

// ── Step 2: Upload video chunks ──────────────────────────────

async function uploadChunks(
  uploadUrl: string,
  filePath: string,
  fileSize: number
): Promise<void> {
  const chunkSize =
    fileSize <= MAX_CHUNK_SIZE ? fileSize : MAX_CHUNK_SIZE;
  const totalChunks = Math.ceil(fileSize / chunkSize);

  const fd = await fs.promises.open(filePath, "r");

  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, fileSize) - 1;
      const size = end - start + 1;

      const buf = Buffer.alloc(size);
      await fd.read(buf, 0, size, start);

      console.log(
        `[tiktok] Uploading chunk ${i + 1}/${totalChunks} ` +
          `(${(size / 1024 / 1024).toFixed(1)}MB)`
      );

      const resp = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(size),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        },
        body: buf,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(
          `Chunk ${i + 1} upload failed (${resp.status}): ${text.slice(0, 200)}`
        );
      }
    }
  } finally {
    await fd.close();
  }
}

// ── Step 3: Poll for publish completion ──────────────────────

export async function checkPublishStatus(publishId: string): Promise<{
  status: string;
  postId?: string;
  failReason?: string;
}> {
  const resp = await tiktokFetch(
    `${API_BASE}/post/publish/status/fetch/`,
    {
      method: "POST",
      body: JSON.stringify({ publish_id: publishId }),
    }
  );

  const json = (await resp.json()) as TikTokApiResponse<{
    status?: string;
    fail_reason?: string;
    publicaly_available_post_id?: string[];
  }>;

  assertOk(json, "status fetch");

  return {
    status: json.data?.status ?? "FAILED",
    postId: json.data?.publicaly_available_post_id?.[0],
    failReason: json.data?.fail_reason,
  };
}

/**
 * Poll until publish completes or fails.
 * Returns the published post ID if successful.
 */
async function waitForPublish(
  publishId: string,
  timeoutMs = 300_000 // 5 minutes
): Promise<string | undefined> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5000));

    const { status, postId, failReason } = await checkPublishStatus(publishId);
    console.log(`[tiktok] Publish status: ${status}`);

    if (status === "PUBLISH_COMPLETE") {
      return postId;
    }
    if (status === "FAILED" || status === "PUBLISH_CANCELED") {
      throw new Error(`TikTok publish failed: ${failReason ?? status}`);
    }
    // PROCESSING_UPLOAD, PROCESSING_DOWNLOAD — keep polling
  }

  throw new Error("TikTok publish timed out after 5 minutes");
}

// ── Main export ──────────────────────────────────────────────

/**
 * Upload a video to TikTok via the Direct Post API.
 *
 * Flow: init → chunked upload → poll until complete.
 * Video is published as SELF_ONLY (private) by default.
 */
export async function uploadToTikTok(
  opts: TikTokUploadOptions
): Promise<TikTokUploadResult> {
  const stat = fs.statSync(opts.videoFilePath);
  const fileSize = stat.size;

  // TikTok max: 4 GB
  if (fileSize > 4 * 1024 * 1024 * 1024) {
    throw new Error("Video file exceeds TikTok's 4GB limit");
  }

  console.log(
    `[tiktok] Starting upload (${(fileSize / 1024 / 1024).toFixed(1)}MB)...`
  );

  // Step 1: Init the post + get upload URL
  const { uploadUrl, publishId } = await initDirectPost(opts, fileSize);
  console.log(`[tiktok] publish_id: ${publishId}`);

  // Step 2: Upload video file in chunks
  await uploadChunks(uploadUrl, opts.videoFilePath, fileSize);
  console.log("[tiktok] All chunks uploaded");

  // Step 3: Poll until TikTok finishes processing
  console.log("[tiktok] Waiting for TikTok to process...");
  const postId = await waitForPublish(publishId);

  if (postId) {
    console.log(`[tiktok] Published! Post ID: ${postId}`);
  }

  return { publishId };
}
