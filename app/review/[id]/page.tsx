"use client";

import { useEffect, useState, use, useCallback } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import type { SubtitleSegment } from "@/lib/db/types";

interface TikTokCreatorInfo {
  creator_nickname?: string;
  creator_username?: string;
  creator_avatar_url?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

interface Job {
  id: string;
  platform: string;
  sourceId: string;
  sourceType: string;
  title: string;
  description: string;
  thumbnail: string;
  sourceUrl: string;
  transcript: string;
  translatedTitle: string;
  translatedDesc: string;
  subtitles: string;
  tags: string;
  status: string;
  targetLanguage: string;
  youtubeUrl: string;
  errorMsg: string;
  authorName: string;
  viewCount: number;
  likeCount: number;
  duration: number;
  localVideoPath: string;
  processedVideoPath: string;
}

function formatSRT(segments: SubtitleSegment[]): string {
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

export default function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishTargets, setPublishTargets] = useState<Record<string, boolean>>({
    YOUTUBE: true,
    TIKTOK: false,
  });
  const [toast, setToast] = useState<string | null>(null);

  // TikTok posting options (mandatory per Content Sharing Guidelines)
  const [tiktokCreatorInfo, setTiktokCreatorInfo] = useState<TikTokCreatorInfo | null>(null);
  const [tiktokCreatorLoading, setTiktokCreatorLoading] = useState(false);
  const [tiktokPrivacyLevel, setTiktokPrivacyLevel] = useState("");
  const [tiktokAllowComment, setTiktokAllowComment] = useState(false);
  const [tiktokAllowDuet, setTiktokAllowDuet] = useState(false);
  const [tiktokAllowStitch, setTiktokAllowStitch] = useState(false);
  const [tiktokCommercial, setTiktokCommercial] = useState(false);
  const [tiktokBrandedContent, setTiktokBrandedContent] = useState(false);
  const [tiktokYourBrand, setTiktokYourBrand] = useState(false);

  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editSubtitles, setEditSubtitles] = useState<SubtitleSegment[]>([]);

  // Thumbnail state
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbTime, setThumbTime] = useState(5);
  const [generatingThumb, setGeneratingThumb] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchJob = useCallback(async () => {
    const res = await fetch(`/api/jobs/${id}`);
    const data = (await res.json()) as { job: Job };
    setJob(data.job);
    setEditTitle(data.job.translatedTitle || data.job.title);
    setEditDesc(data.job.translatedDesc || data.job.description);
    setEditTags((JSON.parse(data.job.tags || "[]") as string[]).join(", "));
    setEditSubtitles(
      JSON.parse(data.job.subtitles || "[]") as SubtitleSegment[]
    );
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Fetch TikTok creator info when TikTok target is selected
  const fetchTiktokCreatorInfo = async () => {
    if (tiktokCreatorInfo || tiktokCreatorLoading) return;
    setTiktokCreatorLoading(true);
    try {
      const res = await fetch("/api/tiktok/creator-info");
      const data = (await res.json()) as {
        data?: TikTokCreatorInfo;
        error?: string;
      };
      if (data.data) {
        setTiktokCreatorInfo(data.data);
        // Set default privacy level to first available option
        if (data.data.privacy_level_options?.length) {
          setTiktokPrivacyLevel(data.data.privacy_level_options[0]);
        }
      }
    } catch {
      // non-fatal
    } finally {
      setTiktokCreatorLoading(false);
    }
  };

  // Try loading existing thumbnail
  useEffect(() => {
    fetch(`/api/jobs/${id}/thumbnail`)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (blob) setThumbUrl(URL.createObjectURL(blob));
      });
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const tagsArray = editTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      await fetch(`/api/jobs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translatedTitle: editTitle,
          translatedDesc: editDesc,
          tags: tagsArray,
          subtitles: editSubtitles,
        }),
      });
      showToast("已保存");
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    const targets = Object.entries(publishTargets)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (targets.length === 0) {
      showToast("请至少选择一个发布平台");
      return;
    }
    if (targets.includes("TIKTOK") && !tiktokPrivacyLevel) {
      showToast("请选择 TikTok 隐私设置");
      return;
    }
    await handleSave();
    setPublishing(true);
    try {
      const res = await fetch(`/api/jobs/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets,
          tiktokOptions: targets.includes("TIKTOK")
            ? {
                privacyLevel: tiktokPrivacyLevel,
                allowComment: tiktokAllowComment,
                allowDuet: tiktokAllowDuet,
                allowStitch: tiktokAllowStitch,
                brandedContent: tiktokBrandedContent,
                yourBrand: tiktokYourBrand,
              }
            : undefined,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "发布失败");
      showToast(`正在上传到 ${targets.join(", ")}…`);
      await fetchJob();
      startPolling();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "发布出错");
      setPublishing(false);
    }
  };

  const startPolling = () => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${id}`);
        const data = (await res.json()) as { job: Job };
        const newStatus = data.job.status;
        if (newStatus !== "PUBLISHING") {
          clearInterval(interval);
          setPublishing(false);
          setJob(data.job);
          if (newStatus === "PUBLISHED") {
            showToast("上传成功！");
          } else if (newStatus === "FAILED") {
            showToast("上传失败: " + (data.job.errorMsg || "未知错误"));
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);
    // Safety: stop polling after 5 minutes
    setTimeout(() => { clearInterval(interval); setPublishing(false); }, 300_000);
  };

  const handleDownloadSRT = () => {
    if (!editSubtitles.length) return;
    const srt = formatSRT(editSubtitles);
    const blob = new Blob([srt], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${id}.srt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleGenerateThumbnail = async () => {
    setGeneratingThumb(true);
    try {
      const res = await fetch(`/api/jobs/${id}/thumbnail?t=${thumbTime}`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        throw new Error(err.error);
      }
      const blob = await res.blob();
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
      setThumbUrl(URL.createObjectURL(blob));
      showToast("封面已生成");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "封面生成失败");
    } finally {
      setGeneratingThumb(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">加载中…</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-500">任务不存在</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <a href="/" className="text-gray-500 hover:text-gray-700 text-sm">
            ← 返回
          </a>
          <h1 className="font-semibold text-gray-900 truncate flex-1">
            审核 · {job.title}
          </h1>
          <StatusBadge status={job.status} />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Original */}
        <div className="space-y-4">
          {/* Video Preview */}
          {(job.processedVideoPath || job.localVideoPath) && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="font-semibold text-sm text-gray-500 mb-3">
                {job.processedVideoPath ? "配音后视频预览" : "原始视频预览"}
              </h2>
              <video
                controls
                className="w-full rounded-lg aspect-video bg-black"
                src={`/api/jobs/${id}/video?type=processed`}
              >
                Your browser does not support the video tag.
              </video>
              {job.processedVideoPath && job.localVideoPath && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                    查看原始视频（配音前）
                  </summary>
                  <video
                    controls
                    className="w-full rounded-lg aspect-video bg-black mt-2"
                    src={`/api/jobs/${id}/video?type=original`}
                  >
                    Your browser does not support the video tag.
                  </video>
                </details>
              )}
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-sm text-gray-500 mb-3">
              原始内容（中文）
            </h2>
            {job.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/proxy/image?url=${encodeURIComponent(job.thumbnail)}`}
                alt={job.title}
                className="w-full rounded-lg mb-3 aspect-video object-cover bg-gray-100"
              />
            )}
            <p className="font-medium text-sm mb-1">{job.title}</p>
            <p className="text-xs text-gray-500 mb-3 line-clamp-3">
              {job.description}
            </p>
            <div className="flex gap-3 text-xs text-gray-400">
              <span>▶ {job.viewCount.toLocaleString()}</span>
              <span>👍 {job.likeCount.toLocaleString()}</span>
              <span>@{job.authorName}</span>
            </div>
            <a
              href={job.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline mt-2 block"
            >
              {job.platform === "BILIBILI" ? "查看 B 站原视频" :
               job.platform === "DOUYIN" ? "查看抖音原视频" :
               job.platform === "XIAOHONGSHU" ? "查看小红书原笔记" :
               "查看原内容"} →
            </a>
          </div>

          {/* Transcript */}
          {job.transcript && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="font-semibold text-sm text-gray-500 mb-2">
                转录文本（{editSubtitles.length} 段）
              </h2>
              <div className="max-h-48 overflow-y-auto text-xs text-gray-600 leading-relaxed">
                {job.transcript}
              </div>
            </div>
          )}

          {/* Thumbnail Generator */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-sm text-gray-500 mb-3">
              封面图
            </h2>
            {thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbUrl}
                alt="封面预览"
                className="w-full rounded-lg mb-3 aspect-video object-cover bg-gray-100"
              />
            ) : (
              <div className="w-full rounded-lg mb-3 aspect-video bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
                点击下方按钮从视频中截取封面
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 shrink-0">截取时间</label>
              <input
                type="range"
                min={0}
                max={job.duration || 60}
                value={thumbTime}
                onChange={(e) => setThumbTime(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-xs text-gray-500 w-10 text-right">
                {thumbTime}s
              </span>
              <button
                onClick={handleGenerateThumbnail}
                disabled={generatingThumb}
                className="text-xs px-3 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 shrink-0"
              >
                {generatingThumb ? "截取中…" : "截取封面"}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Editable translated content */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
            <h2 className="font-semibold text-sm text-gray-500">
              本地化内容（{job.targetLanguage}）— 可编辑
            </h2>

            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                标题（YouTube 最多 100 字符）
              </label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={100}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1 text-right">
                {editTitle.length}/100
              </p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                描述
              </label>
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={5}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                标签（逗号分隔）
              </label>
              <input
                type="text"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="Pocomo, gaming, RPG, ..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Subtitles */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm text-gray-500">
                字幕（{editSubtitles.length} 条）
              </h2>
              {editSubtitles.length > 0 && (
                <button
                  onClick={handleDownloadSRT}
                  className="text-xs px-3 py-1 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                >
                  下载 SRT
                </button>
              )}
            </div>
            {editSubtitles.length > 0 ? (
              <div className="max-h-64 overflow-y-auto space-y-2">
                {editSubtitles.map((seg, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-xs text-gray-400 whitespace-nowrap pt-1.5 w-24 shrink-0">
                      {seg.start.toFixed(1)}s
                    </span>
                    <input
                      type="text"
                      value={seg.text}
                      onChange={(e) => {
                        const updated = [...editSubtitles];
                        updated[i] = { ...seg, text: e.target.value };
                        setEditSubtitles(updated);
                      }}
                      className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">
                暂无字幕数据（SenseVoice 未返回分段时间戳）
              </p>
            )}
          </div>

          {/* Error */}
          {job.errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600">
              {job.errorMsg}
            </div>
          )}

          {/* Publication results */}
          {job.youtubeUrl && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3">
              <p className="text-xs text-green-700 font-medium mb-1">
                已上传至 YouTube（私有状态）
              </p>
              <a
                href={job.youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-700 hover:underline"
              >
                {job.youtubeUrl}
              </a>
            </div>
          )}

          {/* Publish targets + action buttons */}
          {job.status === "REVIEW_PENDING" && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <h2 className="font-semibold text-sm text-gray-500">发布平台</h2>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={publishTargets.YOUTUBE}
                    onChange={(e) =>
                      setPublishTargets((p) => ({ ...p, YOUTUBE: e.target.checked }))
                    }
                    className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <span className="text-gray-700">YouTube</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={publishTargets.TIKTOK}
                    onChange={(e) => {
                      setPublishTargets((p) => ({ ...p, TIKTOK: e.target.checked }));
                      if (e.target.checked) fetchTiktokCreatorInfo();
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-700">TikTok</span>
                </label>
              </div>

              {/* ── TikTok settings panel ─────────────────────── */}
              {publishTargets.TIKTOK && (
                <div className="mt-3 border border-gray-100 rounded-xl bg-gray-50 p-4 space-y-4 text-sm">
                  {/* Creator info */}
                  <div className="flex items-center gap-3">
                    {tiktokCreatorInfo?.creator_avatar_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={tiktokCreatorInfo.creator_avatar_url}
                        alt="avatar"
                        className="w-9 h-9 rounded-full object-cover bg-gray-200"
                      />
                    )}
                    {tiktokCreatorLoading ? (
                      <span className="text-gray-400 text-xs">正在获取账号信息…</span>
                    ) : tiktokCreatorInfo ? (
                      <div>
                        <p className="font-medium text-gray-800 leading-tight">
                          {tiktokCreatorInfo.creator_nickname ?? tiktokCreatorInfo.creator_username ?? "—"}
                        </p>
                        {tiktokCreatorInfo.creator_username && (
                          <p className="text-xs text-gray-400">@{tiktokCreatorInfo.creator_username}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">账号信息获取失败</span>
                    )}
                  </div>

                  {/* Privacy level — pill buttons */}
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-2">
                      隐私设置 <span className="text-red-500">*</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(tiktokCreatorInfo?.privacy_level_options ?? [
                        "PUBLIC_TO_EVERYONE",
                        "MUTUAL_FOLLOW_FRIENDS",
                        "FOLLOWER_OF_CREATOR",
                        "SELF_ONLY",
                      ]).map((opt) => {
                        const label =
                          opt === "PUBLIC_TO_EVERYONE" ? "所有人可见" :
                          opt === "MUTUAL_FOLLOW_FRIENDS" ? "互相关注的好友" :
                          opt === "FOLLOWER_OF_CREATOR" ? "我的粉丝" :
                          opt === "SELF_ONLY" ? "仅自己可见" : opt;
                        const active = tiktokPrivacyLevel === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setTiktokPrivacyLevel(opt)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                              active
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Interaction permissions */}
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-2">互动权限</p>
                    <div className="flex flex-col gap-2">
                      <label className={`flex items-center gap-2 ${tiktokCreatorInfo?.comment_disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          checked={tiktokAllowComment}
                          disabled={tiktokCreatorInfo?.comment_disabled}
                          onChange={(e) => setTiktokAllowComment(e.target.checked)}
                          className="rounded border-gray-300"
                        />
                        <span className="text-gray-700">
                          允许评论
                          {tiktokCreatorInfo?.comment_disabled && <span className="text-gray-400 ml-1">（账号已关闭）</span>}
                        </span>
                      </label>
                      <label className={`flex items-center gap-2 ${tiktokCreatorInfo?.duet_disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          checked={tiktokAllowDuet}
                          disabled={tiktokCreatorInfo?.duet_disabled}
                          onChange={(e) => setTiktokAllowDuet(e.target.checked)}
                          className="rounded border-gray-300"
                        />
                        <span className="text-gray-700">
                          允许合拍（Duet）
                          {tiktokCreatorInfo?.duet_disabled && <span className="text-gray-400 ml-1">（账号已关闭）</span>}
                        </span>
                      </label>
                      <label className={`flex items-center gap-2 ${tiktokCreatorInfo?.stitch_disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          checked={tiktokAllowStitch}
                          disabled={tiktokCreatorInfo?.stitch_disabled}
                          onChange={(e) => setTiktokAllowStitch(e.target.checked)}
                          className="rounded border-gray-300"
                        />
                        <span className="text-gray-700">
                          允许跟拍（Stitch）
                          {tiktokCreatorInfo?.stitch_disabled && <span className="text-gray-400 ml-1">（账号已关闭）</span>}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Commercial content disclosure */}
                  <div>
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-xs font-medium text-gray-600">商业内容披露</p>
                        <p className="text-xs text-gray-400 mt-0.5">是否包含品牌推广或赞助内容</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={tiktokCommercial}
                        onClick={() => {
                          setTiktokCommercial((v) => {
                            if (v) { setTiktokBrandedContent(false); setTiktokYourBrand(false); }
                            return !v;
                          });
                        }}
                        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
                          tiktokCommercial ? "bg-blue-600" : "bg-gray-300"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${
                            tiktokCommercial ? "translate-x-4.5" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </label>
                    {tiktokCommercial && (
                      <div className="mt-2 space-y-2 pl-1">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tiktokYourBrand}
                            onChange={(e) => setTiktokYourBrand(e.target.checked)}
                            className="rounded border-gray-300"
                          />
                          <span className="text-gray-700 text-xs">你的品牌（Your Brand）— 推广自己的产品或服务</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tiktokBrandedContent}
                            onChange={(e) => setTiktokBrandedContent(e.target.checked)}
                            className="rounded border-gray-300"
                          />
                          <span className="text-gray-700 text-xs">品牌内容（Branded Content）— 推广第三方品牌</span>
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Policy agreement */}
                  <p className="text-xs text-gray-400 border-t border-gray-200 pt-3 leading-relaxed">
                    点击「发布」即表示你同意 TikTok 的{" "}
                    <a
                      href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline"
                    >
                      Music Usage Confirmation
                    </a>
                    {tiktokBrandedContent && (
                      <>
                        {" "}及{" "}
                        <a
                          href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:underline"
                        >
                          Branded Content Policy
                        </a>
                      </>
                    )}
                    。内容提交后可能需要几分钟才会出现在你的主页。
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {saving ? "保存中…" : "保存修改"}
            </button>
            {job.status === "REVIEW_PENDING" && (
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {publishing ? "上传中…" : "发布"}
              </button>
            )}
          </div>
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 px-4 py-3 rounded-xl text-sm text-white bg-gray-900 shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
