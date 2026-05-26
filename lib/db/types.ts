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

export interface BilibiliSearchResult {
  bvid: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: number; // seconds
  viewCount: number;
  likeCount: number;
  authorName: string;
  authorId: string;
  publishedAt: string;
  sourceUrl: string;
}
