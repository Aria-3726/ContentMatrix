-- Multi-platform support: rename bvid to sourceId, add Publication model
ALTER TABLE Job ADD COLUMN sourceId TEXT DEFAULT '';
ALTER TABLE Job ADD COLUMN sourceType TEXT DEFAULT 'VIDEO';
UPDATE Job SET sourceId = bvid WHERE sourceId = '';

CREATE TABLE "Publication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL DEFAULT '',
    "externalUrl" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMsg" TEXT NOT NULL DEFAULT '',
    "publishedAt" DATETIME,
    CONSTRAINT "Publication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

DROP INDEX IF EXISTS "Job_bvid_key";
CREATE UNIQUE INDEX "Job_platform_sourceId_key" ON "Job"("platform", "sourceId");
CREATE INDEX "Job_platform_idx" ON "Job"("platform");
CREATE UNIQUE INDEX "Publication_jobId_platform_key" ON "Publication"("jobId", "platform");
CREATE INDEX "Publication_jobId_idx" ON "Publication"("jobId");
