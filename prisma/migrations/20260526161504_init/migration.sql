-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'BILIBILI',
    "bvid" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "thumbnail" TEXT NOT NULL DEFAULT '',
    "duration" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "authorName" TEXT NOT NULL DEFAULT '',
    "authorId" TEXT NOT NULL DEFAULT '',
    "publishedAt" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "errorMsg" TEXT NOT NULL DEFAULT '',
    "localVideoPath" TEXT NOT NULL DEFAULT '',
    "processedVideoPath" TEXT NOT NULL DEFAULT '',
    "transcript" TEXT NOT NULL DEFAULT '',
    "targetLanguage" TEXT NOT NULL DEFAULT 'EN',
    "translatedTitle" TEXT NOT NULL DEFAULT '',
    "translatedDesc" TEXT NOT NULL DEFAULT '',
    "subtitles" TEXT NOT NULL DEFAULT '[]',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "youtubeVideoId" TEXT NOT NULL DEFAULT '',
    "youtubeUrl" TEXT NOT NULL DEFAULT '',
    "publishedYoutubeAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_bvid_key" ON "Job"("bvid");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");
