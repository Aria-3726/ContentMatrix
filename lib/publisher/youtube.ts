/**
 * YouTube Data API v3 publisher.
 * Requires OAuth2 credentials with youtube.upload scope.
 *
 * Setup:
 *   1. Create a project in Google Cloud Console
 *   2. Enable YouTube Data API v3
 *   3. Create OAuth2 credentials → download client_secret.json
 *   4. Run the auth flow once to get refresh_token
 *   5. Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN in .env
 */

import { google } from "googleapis";
import fs from "fs";
import type { SubtitleSegment } from "@/lib/db/types";

function getYouTubeClient() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "YouTube OAuth2 credentials not configured. " +
      "Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN in .env"
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "urn:ietf:wg:oauth:2.0:oob"
  );

  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.youtube({ version: "v3", auth: oauth2Client });
}

export interface UploadOptions {
  videoFilePath: string;
  title: string;
  description: string;
  tags: string[];
  thumbnailPath?: string;
  srtPath?: string;
  language?: string; // e.g. "en", "ja", "ko"
  categoryId?: string; // 20 = Gaming
}

export interface UploadResult {
  videoId: string;
  url: string;
}

/**
 * Upload a video to YouTube and return the video ID + URL.
 */
export async function uploadToYouTube(
  opts: UploadOptions
): Promise<UploadResult> {
  const youtube = getYouTubeClient();

  const fileSize = fs.statSync(opts.videoFilePath).size;
  const fileStream = fs.createReadStream(opts.videoFilePath);

  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: opts.title.slice(0, 100), // YouTube max 100 chars
        description: opts.description.slice(0, 5000),
        tags: opts.tags.slice(0, 500), // YouTube max 500 tags
        categoryId: opts.categoryId ?? "20", // Gaming
        defaultLanguage: opts.language ?? "en",
        defaultAudioLanguage: opts.language ?? "en",
      },
      status: {
        privacyStatus: "private", // Always private first — review before going public
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fileStream,
    },
  });

  const videoId = response.data.id;
  if (!videoId) throw new Error("YouTube upload returned no video ID");

  // Optionally set thumbnail
  if (opts.thumbnailPath && fs.existsSync(opts.thumbnailPath)) {
    try {
      await youtube.thumbnails.set({
        videoId,
        media: { body: fs.createReadStream(opts.thumbnailPath) },
      });
    } catch {
      // Non-fatal: thumbnail upload may fail if account not verified
      console.warn("Thumbnail upload failed (non-fatal)");
    }
  }

  // Upload SRT subtitles — retry up to 3 times with delay
  // (YouTube needs processing time before captions can be added)
  if (opts.srtPath && fs.existsSync(opts.srtPath)) {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`Subtitle upload retry ${attempt}/${maxRetries} — waiting 15s...`);
          await new Promise((r) => setTimeout(r, 15_000));
        }
        await youtube.captions.insert({
          part: ["snippet"],
          requestBody: {
            snippet: {
              videoId,
              language: opts.language ?? "en",
              name: opts.language === "en" ? "English" : opts.language ?? "Subtitles",
            },
          },
          media: {
            mimeType: "application/x-subrip",
            body: fs.createReadStream(opts.srtPath),
          },
        });
        console.log("Subtitle upload succeeded on attempt", attempt);
        break;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn(`Subtitle upload attempt ${attempt} failed:`, detail);
        if (attempt === maxRetries) {
          console.warn("Subtitle upload exhausted all retries (non-fatal)");
        }
      }
    }
  }

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

/**
 * Generate a simple SRT subtitle file from subtitle segments.
 * Can be uploaded separately or burned in via FFmpeg.
 */
export function generateSRT(segments: SubtitleSegment[]): string {
  return segments
    .map((seg, i) => {
      const fmt = (s: number) => {
        const h = Math.floor(s / 3600).toString().padStart(2, "0");
        const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
        const sec = Math.floor(s % 60).toString().padStart(2, "0");
        const ms = Math.round((s % 1) * 1000).toString().padStart(3, "0");
        return `${h}:${m}:${sec},${ms}`;
      };
      return `${i + 1}\n${fmt(seg.start)} --> ${fmt(seg.end)}\n${seg.text}\n`;
    })
    .join("\n");
}
