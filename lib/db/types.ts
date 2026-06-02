export type JobStatus =
  | "DISCOVERED"
  | "DOWNLOADING"
  | "DOWNLOADED"
  | "TRANSCRIBING"
  | "TRANSCRIBED"
  | "TRANSLATING"
  | "TRANSLATED"
  | "DUBBING"
  | "REVIEW_PENDING"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED";

export type TargetLanguage = "EN" | "JA" | "KO";

export interface SubtitleSegment {
  start: number; // seconds
  end: number;
  text: string;
}

/** Platform-agnostic search result returned by all scrapers */
export interface ScraperResult {
  platform: string;       // BILIBILI | DOUYIN | XIAOHONGSHU
  sourceId: string;       // Platform-specific ID (bvid, aweme_id, note_id)
  sourceType: string;     // VIDEO | IMAGE_NOTE
  sourceUrl: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: number;       // seconds (0 for image notes)
  viewCount: number;
  likeCount: number;
  authorName: string;
  authorId: string;
  publishedAt: string;
  /** IMAGE_NOTE only — image URLs extracted at scrape time */
  imageUrls?: string[];
}
