/**
 * AI dubbing — generate English voiceover via Microsoft Edge TTS (neural voices),
 * then replace the original Chinese audio track using FFmpeg.
 *
 * Edge TTS provides:
 * - Native English pronunciation (no Chinese accent)
 * - Word-level subtitle timestamps
 * - Free, no API key needed
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const DOWNLOAD_DIR =
  process.env.VIDEO_DOWNLOAD_DIR ?? path.join(process.cwd(), "tmp", "videos");

// High-quality Microsoft neural voices for English narration
const TTS_VOICE = process.env.TTS_VOICE ?? "en-US-AndrewMultilingualNeural";

interface WordTiming {
  part: string;  // word text
  start: number; // milliseconds
  end: number;   // milliseconds
}

export interface DubResult {
  dubbedVideoPath: string;
  ttsAudioPath: string;
  subtitles: Array<{ start: number; end: number; text: string }>;
}

/**
 * Generate English speech from text using Microsoft Edge TTS.
 * Returns word-level timing data for accurate subtitles.
 */
async function generateSpeech(
  text: string,
  outputPath: string
): Promise<WordTiming[]> {
  // Dynamic import for ESM/CJS compatibility
  const { EdgeTTS } = await import("node-edge-tts");

  const tts = new EdgeTTS({
    voice: TTS_VOICE,
    saveSubtitles: true,
    timeout: 120_000, // 2 minutes — default 10s is too short in some network conditions
  });

  await tts.ttsPromise(text, outputPath);

  // edge-tts saves subtitles as {outputPath}.json
  const jsonPath = `${outputPath}.json`;
  if (fs.existsSync(jsonPath)) {
    const raw = JSON.parse(await fs.promises.readFile(jsonPath, "utf-8"));
    await fs.promises.unlink(jsonPath).catch(() => {});
    return Array.isArray(raw) ? raw : [];
  }
  return [];
}

/**
 * Map word-level TTS timings to sentence-level subtitle segments.
 * Distributes words proportionally across the original subtitle texts,
 * giving each segment a precise start/end based on actual speech timing.
 */
function buildSubtitleSegments(
  wordTimings: WordTiming[],
  originalSubtitles: Array<{ start: number; end: number; text: string }>
): Array<{ start: number; end: number; text: string }> {
  if (wordTimings.length === 0 || originalSubtitles.length === 0) {
    return originalSubtitles;
  }

  const totalChars = originalSubtitles.reduce((sum, s) => sum + s.text.length, 0);
  const totalWords = wordTimings.length;

  const result: Array<{ start: number; end: number; text: string }> = [];
  let wordIdx = 0;

  for (let i = 0; i < originalSubtitles.length; i++) {
    const sub = originalSubtitles[i];
    const isLast = i === originalSubtitles.length - 1;

    // Proportionally assign words to this segment
    const proportion = totalChars > 0
      ? sub.text.length / totalChars
      : 1 / originalSubtitles.length;

    const wordsForSegment = isLast
      ? totalWords - wordIdx // last segment gets all remaining words
      : Math.max(1, Math.round(totalWords * proportion));

    const endWordIdx = Math.min(wordIdx + wordsForSegment, totalWords);

    if (wordIdx < totalWords) {
      const segStart = wordTimings[wordIdx].start / 1000; // ms → seconds
      const lastWord = wordTimings[Math.min(endWordIdx - 1, totalWords - 1)];
      const segEnd = lastWord.end / 1000;

      result.push({
        start: Math.round(segStart * 100) / 100,
        end: Math.round(segEnd * 100) / 100,
        text: sub.text,
      });
    } else {
      // No more words — keep segment with last known timing
      const lastEnd = result.length > 0 ? result[result.length - 1].end : 0;
      result.push({ start: lastEnd, end: lastEnd, text: sub.text });
    }

    wordIdx = endWordIdx;
  }

  return result;
}

/**
 * Replace the audio track in the video with AI-generated English voiceover.
 * Returns the dubbed video path and accurate subtitle timestamps.
 */
export async function dubVideo(
  videoPath: string,
  narrationText: string,
  jobId: string,
  originalSubtitles?: Array<{ start: number; end: number; text: string }>
): Promise<DubResult> {
  await fs.promises.mkdir(DOWNLOAD_DIR, { recursive: true });

  const ttsAudioPath = path.join(DOWNLOAD_DIR, `${jobId}_tts.mp3`);
  const dubbedVideoPath = path.join(DOWNLOAD_DIR, `${jobId}_dubbed.mp4`);

  // Step 1: Generate English speech with Edge TTS
  const wordTimings = await generateSpeech(narrationText, ttsAudioPath);

  // Step 2: Build accurate subtitle segments from word-level timings
  const subtitles = originalSubtitles && originalSubtitles.length > 0
    ? buildSubtitleSegments(wordTimings, originalSubtitles)
    : [];

  // Step 3: Replace audio in video
  await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-i", ttsAudioPath,
    "-c:v", "copy",
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-shortest",
    "-y",
    dubbedVideoPath,
  ], {
    timeout: 5 * 60 * 1000,
    env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? "/usr/bin:/bin"}` },
  });

  return { dubbedVideoPath, ttsAudioPath, subtitles };
}
