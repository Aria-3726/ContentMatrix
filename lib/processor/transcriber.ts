/**
 * Audio transcription using SiliconFlow SenseVoice API.
 * OpenAI-compatible endpoint at api.siliconflow.cn.
 */

import OpenAI from "openai";
import fs from "fs";

function getClient(): OpenAI {
  const key = process.env.SILICONFLOW_API_KEY;
  if (!key) throw new Error("SILICONFLOW_API_KEY is not configured");
  return new OpenAI({
    apiKey: key,
    baseURL: "https://api.siliconflow.cn/v1",
    timeout: 5 * 60 * 1000,
  });
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface TranscribeResult {
  text: string;
  segments: TranscriptSegment[];
  language: string;
}

export async function transcribeFile(
  filePath: string,
  language = "zh"
): Promise<TranscribeResult> {
  const client = getClient();
  const fileStream = fs.createReadStream(filePath);

  const response = await client.audio.transcriptions.create({
    file: fileStream,
    model: "FunAudioLLM/SenseVoiceSmall",
    language,
  });

  const text = typeof response === "string" ? response : (response as { text: string }).text ?? "";

  // SenseVoice doesn't return segments — split text into sentence-level
  // segments with estimated timestamps spread across the duration.
  const segments: TranscriptSegment[] = [];
  if (text) {
    // Split on Chinese/English sentence boundaries
    const sentences = text
      .split(/(?<=[。！？.!?\n])\s*/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (sentences.length === 0) {
      segments.push({ id: 0, start: 0, end: 0, text });
    } else {
      // We don't know exact duration here — use text length ratio.
      // Actual timestamps will be estimated in the transcribe route
      // using the video's known duration.
      for (let i = 0; i < sentences.length; i++) {
        segments.push({ id: i, start: 0, end: 0, text: sentences[i] });
      }
    }
  }

  return { text, language, segments };
}
