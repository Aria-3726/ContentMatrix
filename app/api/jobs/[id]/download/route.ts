/**
 * POST /api/jobs/:id/download
 * Trigger download for a job.
 *   - VIDEO: uses yt-dlp to download from source URL
 *   - IMAGE_NOTE: fetches image URLs from note page and stores them for carousel publishing
 * Updates job status: DOWNLOADING → DOWNLOADED
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { downloadVideo } from "@/lib/processor/downloader";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!["DISCOVERED", "FAILED"].includes(job.status)) {
    return NextResponse.json(
      { error: `Cannot download from status: ${job.status}` },
      { status: 409 }
    );
  }

  // Mark as downloading
  await prisma.job.update({
    where: { id },
    data: { status: "DOWNLOADING", errorMsg: "" },
  });

  // Run download asynchronously
  (async () => {
    try {
      let filePath: string;

      if (job.sourceType === "IMAGE_NOTE") {
        // IMAGE_NOTE: fetch image URLs and store for carousel publishing (no video conversion)
        const imageUrls = await fetchNoteImageUrls(job.sourceUrl, job.platform);
        await prisma.job.update({
          where: { id },
          data: {
            status: "DOWNLOADED",
            imageUrls: JSON.stringify(imageUrls),
            // Estimate duration as 3s per image for any downstream use
            ...(job.duration === 0 ? { duration: imageUrls.length * 3 } : {}),
          },
        });
        return; // early return — no filePath needed
      } else {
        // VIDEO: standard yt-dlp download
        const result = await downloadVideo(job.sourceUrl, id, job.platform);
        filePath = result.filePath;
      }

      await prisma.job.update({
        where: { id },
        data: {
          status: "DOWNLOADED",
          localVideoPath: filePath,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.job.update({
        where: { id },
        data: { status: "FAILED", errorMsg: msg },
      });
    }
  })();

  return NextResponse.json({
    success: true,
    message:
      job.sourceType === "IMAGE_NOTE"
        ? "Image URL extraction started"
        : "Download started",
  });
}

/**
 * Fetch image URLs from a Xiaohongshu note page via __INITIAL_STATE__.
 */
async function fetchNoteImageUrls(
  sourceUrl: string,
  platform: string
): Promise<string[]> {
  if (platform !== "XIAOHONGSHU") {
    throw new Error(`IMAGE_NOTE download not supported for platform: ${platform}`);
  }

  const cookieStr = process.env.XIAOHONGSHU_COOKIE;
  const resp = await fetch(sourceUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Referer: "https://www.xiaohongshu.com/",
      ...(cookieStr ? { Cookie: cookieStr } : {}),
    },
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch note page (${resp.status})`);
  }

  const html = await resp.text();
  const stateMatch = html.match(
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/
  );

  if (!stateMatch?.[1]) {
    throw new Error(
      "无法从小红书笔记页面提取图片数据（__INITIAL_STATE__ 未找到）"
    );
  }

  try {
    const cleaned = stateMatch[1].replace(/\bundefined\b/g, "null");
    const state = JSON.parse(cleaned);

    // Navigate to note detail → image_list
    const imageUrls: string[] = [];

    // The state structure: noteDetailMap → {noteId} → note → imageList
    const noteMap = state?.note?.noteDetailMap ?? state?.noteDetailMap;
    if (noteMap && typeof noteMap === "object") {
      for (const noteData of Object.values(noteMap)) {
        const note = (noteData as Record<string, unknown>)?.note as Record<string, unknown> | undefined;
        const imageList = note?.imageList as Array<{
          infoList?: Array<{ imageScene?: string; url?: string }>;
          urlDefault?: string;
        }> | undefined;

        if (imageList) {
          for (const img of imageList) {
            // Prefer high-res image
            const bestUrl =
              img.infoList?.find((i) => i.imageScene === "WB_DFT")?.url ??
              img.infoList?.[0]?.url ??
              img.urlDefault;
            if (bestUrl) {
              imageUrls.push(
                bestUrl.startsWith("//") ? `https:${bestUrl}` : bestUrl
              );
            }
          }
        }
      }
    }

    if (imageUrls.length === 0) {
      throw new Error("笔记页面中未找到图片");
    }

    return imageUrls;
  } catch (err) {
    if (err instanceof Error && err.message.includes("未找到")) throw err;
    throw new Error(
      `解析小红书笔记数据失败: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
