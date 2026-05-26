/**
 * Translation & localization using DeepSeek via SiliconFlow.
 * Translates Chinese content (title, description, subtitles) into
 * English, Japanese, or Korean with game-culture-aware localization.
 */

import OpenAI from "openai";
import type { SubtitleSegment, TargetLanguage } from "@/lib/db/types";

function getClient(): OpenAI {
  const key = process.env.SILICONFLOW_API_KEY;
  if (!key) throw new Error("SILICONFLOW_API_KEY is not configured");
  return new OpenAI({
    apiKey: key,
    baseURL: "https://api.siliconflow.cn/v1",
    timeout: 5 * 60 * 1000,
  });
}

const LANG_NAMES: Record<TargetLanguage, string> = {
  EN: "English",
  JA: "Japanese",
  KO: "Korean",
};

const SYSTEM_PROMPT = (lang: string) => `
You are a professional video localization specialist for Chinese gaming content.
Your job is to translate and localize Chinese text about the online game "Pocomo"
into natural, engaging ${lang}.

Guidelines:
- Keep proper nouns (game names, item names, character names) faithful or use the
  official localized names if known.
- Adapt idioms and internet slang to be natural in ${lang}.
- For titles: make them punchy and YouTube-friendly (under 70 chars).
- For descriptions: include relevant keywords for SEO.
- For subtitles: keep segments short, sync timing-appropriate.
- Do NOT add content that wasn't in the original.
`.trim();

export interface TranslationResult {
  title: string;
  description: string;
  subtitles: SubtitleSegment[];
  tags: string[];
}

/**
 * Translate video metadata + subtitles in a single GPT-4o call.
 */
export async function translateContent(opts: {
  title: string;
  description: string;
  segments: Array<{ start: number; end: number; text: string }>;
  targetLanguage: TargetLanguage;
}): Promise<TranslationResult> {
  const client = getClient();
  const lang = LANG_NAMES[opts.targetLanguage];

  const userMessage = JSON.stringify({
    title: opts.title,
    description: opts.description,
    subtitles: opts.segments.map((s, i) => ({
      index: i,
      start: s.start,
      end: s.end,
      text: s.text,
    })),
  });

  const response = await client.chat.completions.create({
    model: "deepseek-ai/DeepSeek-V3",
    messages: [
      { role: "system", content: SYSTEM_PROMPT(lang) },
      {
        role: "user",
        content: `Translate the following JSON from Chinese to ${lang}.
Return ONLY valid JSON with this structure:
{
  "title": "<translated title>",
  "description": "<translated description>",
  "tags": ["tag1", "tag2", ...],
  "subtitles": [
    {"index": 0, "start": 0.0, "end": 2.5, "text": "..."},
    ...
  ]
}

Input:
${userMessage}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const raw = JSON.parse(
    response.choices[0].message.content ?? "{}"
  ) as {
    title?: string;
    description?: string;
    tags?: string[];
    subtitles?: Array<{
      index: number;
      start: number;
      end: number;
      text: string;
    }>;
  };

  const subtitles: SubtitleSegment[] = (raw.subtitles ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text ?? "",
  }));

  return {
    title: raw.title ?? opts.title,
    description: raw.description ?? opts.description,
    subtitles,
    tags: raw.tags ?? [],
  };
}
