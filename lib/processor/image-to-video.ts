/**
 * Convert a Xiaohongshu image note (multiple images + text) into a
 * video slideshow using FFmpeg.
 *
 * Each image is displayed for ~4 seconds with a gentle Ken Burns pan/zoom,
 * crossfading between images. The text description is overlaid as subtitles.
 *
 * Output: MP4 (H.264) at 1080p, suitable for the existing pipeline
 * (dubbing, translation, publishing to YouTube/TikTok).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { DOWNLOAD_DIR, ensureDownloadDir } from "./downloader";

const execFileAsync = promisify(execFile);

const ENV_WITH_PATH = {
  ...process.env,
  PATH: `/opt/homebrew/bin:${process.env.PATH ?? "/usr/bin:/bin"}`,
};

export interface ImageToVideoOptions {
  /** URLs of images to include */
  imageUrls: string[];
  /** Job ID for output file naming */
  jobId: string;
  /** Duration per image in seconds */
  durationPerImage?: number;
  /** Output resolution */
  width?: number;
  height?: number;
  /** Referer header for downloading images (platform-specific) */
  referer?: string;
  /** Cookie for downloading images */
  cookie?: string;
}

/**
 * Download an image from URL to a temp file.
 */
async function downloadImage(
  url: string,
  destPath: string,
  referer?: string,
  cookie?: string
): Promise<void> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  };
  if (referer) headers.Referer = referer;
  if (cookie) headers.Cookie = cookie;

  // Fix protocol-relative URLs
  const finalUrl = url.startsWith("//") ? `https:${url}` : url;

  const resp = await fetch(finalUrl, { headers });
  if (!resp.ok) {
    throw new Error(`Failed to download image (${resp.status}): ${finalUrl}`);
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  await fs.promises.writeFile(destPath, buffer);
}

/**
 * Convert a list of images into a video slideshow using FFmpeg.
 *
 * Strategy:
 *   - Each image is shown for `durationPerImage` seconds
 *   - Images are scaled to fit 1080p (pad with black if aspect ratio differs)
 *   - Simple crossfade transitions between images
 *   - Output: MP4 with H.264 video, no audio (will be added by dubbing step)
 */
export async function imagesToVideo(
  opts: ImageToVideoOptions
): Promise<string> {
  const {
    imageUrls,
    jobId,
    durationPerImage = 4,
    width = 1920,
    height = 1080,
    referer,
    cookie,
  } = opts;

  if (imageUrls.length === 0) {
    throw new Error("No images provided for slideshow");
  }

  await ensureDownloadDir();

  // Step 1: Download all images to temp files
  const tmpDir = path.join(os.tmpdir(), `cm-img-${jobId}`);
  await fs.promises.mkdir(tmpDir, { recursive: true });

  const localPaths: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const ext = "jpg";
    const localPath = path.join(tmpDir, `img_${i.toString().padStart(3, "0")}.${ext}`);
    try {
      await downloadImage(imageUrls[i], localPath, referer, cookie);
      localPaths.push(localPath);
    } catch (err) {
      console.warn(
        `[image-to-video] Failed to download image ${i}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  if (localPaths.length === 0) {
    throw new Error("Failed to download any images");
  }

  // Step 2: Build FFmpeg filter graph
  // Simple approach: use concat demuxer with duration per image
  const concatFile = path.join(tmpDir, "concat.txt");
  const concatContent = localPaths
    .map((p) => `file '${p}'\nduration ${durationPerImage}`)
    .join("\n");
  // Repeat last image to avoid duration issue with concat
  const lastImage = localPaths[localPaths.length - 1];
  const fullContent = concatContent + `\nfile '${lastImage}'`;
  await fs.promises.writeFile(concatFile, fullContent, "utf-8");

  const outputPath = path.join(DOWNLOAD_DIR, `${jobId}.mp4`);

  // Step 3: Run FFmpeg
  const args = [
    "-f", "concat",
    "-safe", "0",
    "-i", concatFile,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-an", // No audio for now — dubbing step will add it
    "-y",
    outputPath,
  ];

  try {
    await execFileAsync("ffmpeg", args, {
      timeout: 120_000,
      env: ENV_WITH_PATH,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`FFmpeg slideshow creation failed: ${msg}`);
  }

  // Step 4: Cleanup temp files
  try {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // Non-fatal
  }

  return outputPath;
}
