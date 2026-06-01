# ContentMatrix

**Pocomo 海外三方号内容工作流**

将 B站/抖音 的游戏内容自动化地 → 下载 → 转录 → AI配音 → 翻译 → 审核 → 发布到 YouTube / TikTok

---

## 工作流

```
B站搜索
  ↓ 质量过滤（播放量、时长、关键词相关性）
内容发现队列
  ↓ yt-dlp 下载
本地视频文件
  ↓ SiliconFlow SenseVoice 转录
中文字幕 + 转录文本
  ↓ DeepSeek-V3 本地化翻译
英文/日文/韩文 标题 + 描述 + 字幕
  ↓ Microsoft Edge TTS AI配音 + FFmpeg 字幕烧录
  ↓ 人工审核（可编辑、视频预览、字幕编辑、封面截取）
  ↓ 一键发布
YouTube（含 SRT 字幕）  /  TikTok（Content Posting API v2）
```

---

## 快速开始

### 1. 安装系统依赖

```bash
# macOS
brew install yt-dlp ffmpeg

# Ubuntu
apt install ffmpeg && pip install yt-dlp
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入下方各 API Key
```

### 3. YouTube OAuth2 初始配置（一次性）

```bash
# 1. Google Cloud Console → 创建项目 → 启用 YouTube Data API v3
# 2. 创建 OAuth2 Desktop 凭证 → 复制 Client ID / Secret 到 .env
# 3. 运行授权脚本：
npx tsx scripts/youtube-auth.ts
# 4. 将输出的 YOUTUBE_REFRESH_TOKEN 粘贴到 .env
```

### 4. 抖音登录（一次性，搜索抖音内容必须）

```bash
# 运行登录助手（会打开真实浏览器）：
npx tsx scripts/douyin-login.ts
# 在浏览器中登录抖音账号，登录成功后关闭窗口
# Session 保存到 .browser-data/douyin/，有效期约 30 天

# 技术说明：抖音搜索 API 需要 a_bogus 动态签名（浏览器端 JS 计算），
# 直接伪造无法通过校验。本方案用 Puppeteer 打开真实浏览器，
# 抖音自己的 JS 生成签名，我们拦截 XHR 响应获取搜索结果。
```

### 5. TikTok OAuth2 初始配置（一次性）

```bash
# 1. TikTok Developer Portal → 创建应用 → 申请 video.publish scope
# 2. 将 Client Key / Secret 填入 .env
# 3. 运行授权脚本（会打开浏览器完成 OAuth）：
npx tsx scripts/tiktok-auth.ts
# 4. 将输出的 TIKTOK_ACCESS_TOKEN / TIKTOK_REFRESH_TOKEN 粘贴到 .env
#
# Sandbox 模式（TikTok 应用审核通过前）：
# TIKTOK_USE_SANDBOX=true  →  视频以草稿（MEDIA_UPLOAD）模式发布
```

### 6. 启动开发服务器

```bash
npm install
npx prisma generate && npx prisma migrate deploy
npm run dev
# 访问 http://localhost:3000
```

---

## 目录结构

```
ContentMatrix/
├── app/
│   ├── page.tsx                  # 主控制台（搜索 + 任务队列）
│   ├── review/[id]/              # 内容审核页（视频预览、字幕编辑、发布设置）
│   ├── terms/                    # 使用条款页面
│   ├── privacy/                  # 隐私政策页面
│   └── api/
│       ├── scrape/               # B站搜索 → 创建任务
│       ├── proxy/image/          # B站缩略图代理
│       ├── tiktok/
│       │   └── creator-info/     # TikTok 创作者信息代理
│       ├── jobs/
│       │   └── [id]/
│       │       ├── download/     # yt-dlp 下载
│       │       ├── transcribe/   # SenseVoice 转录
│       │       ├── translate/    # DeepSeek-V3 翻译
│       │       ├── dub/          # Edge TTS AI配音
│       │       ├── thumbnail/    # FFmpeg 封面截取
│       │       ├── video/        # 视频流式预览
│       │       └── publish/      # YouTube + TikTok 上传
│       └── system-check/         # 环境检查
├── lib/
│   ├── scraper/
│   │   ├── bilibili.ts           # B站搜索 API（含关键词过滤）
│   │   ├── douyin.ts             # 抖音搜索（策略分发：浏览器优先）
│   │   ├── douyin-browser.ts     # 抖音搜索 Puppeteer 方案（XHR 拦截）
│   │   └── xiaohongshu.ts        # 小红书搜索
│   ├── processor/
│   │   ├── downloader.ts         # yt-dlp 封装
│   │   ├── transcriber.ts        # SenseVoice 转录（带时间戳估算）
│   │   ├── translator.ts         # DeepSeek-V3 翻译
│   │   └── dubbing.ts            # Edge TTS 配音 + FFmpeg 音轨替换
│   └── publisher/
│       ├── youtube.ts            # YouTube Data API v3（视频 + 缩略图 + 字幕）
│       └── tiktok.ts             # TikTok Content Posting API v2（FILE_UPLOAD）
├── prisma/schema.prisma          # 数据库 Schema（SQLite）
└── scripts/
    ├── youtube-auth.ts           # YouTube OAuth2 初始化
    ├── tiktok-auth.ts            # TikTok OAuth2 初始化
    └── douyin-login.ts           # 抖音一次性登录（保存浏览器 Session）
```

---

## 任务状态机

```
DISCOVERED → DOWNLOADING → DOWNLOADED → TRANSCRIBING → TRANSCRIBED
           → TRANSLATING → TRANSLATED → DUBBING
           → REVIEW_PENDING → PUBLISHING → PUBLISHED
                                            ↓
                                          FAILED（任意阶段可回退重试）
```

发布失败时任务回退到 `REVIEW_PENDING`，可直接在审核页重试，无需重新处理视频。

---

## TikTok 发布说明

审核页的 TikTok 设置面板遵循 [TikTok Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)，包含：

- **创作者信息**：自动拉取 `/v2/post/publish/creator_info/query/`
- **隐私级别**：仅限创作者可用选项（pill 按钮选择）
- **互动权限**：评论 / 合拍 / 贴贴（根据创作者账号限制自动禁用）
- **商业内容披露**：品牌内容 / 自有品牌开关
- **Music Usage Confirmation** 链接

TikTok 发布流程：
1. `POST /v2/post/publish/video/init/` 获取 `publish_id` 和 `upload_url`
2. 分片 PUT 上传视频（每片 10 MB）
3. 轮询 `/v2/post/publish/status/fetch/` 直至 `PUBLISH_COMPLETE`

---

## 环境变量一览

| 变量 | 说明 |
|------|------|
| `SILICONFLOW_API_KEY` | SiliconFlow SenseVoice 转录 |
| `DEEPSEEK_API_KEY` | DeepSeek-V3 翻译 |
| `YOUTUBE_CLIENT_ID` | Google OAuth2 Client ID |
| `YOUTUBE_CLIENT_SECRET` | Google OAuth2 Client Secret |
| `YOUTUBE_REFRESH_TOKEN` | YouTube 长期 Refresh Token |
| `TIKTOK_CLIENT_KEY` | TikTok 应用 Client Key |
| `TIKTOK_CLIENT_SECRET` | TikTok 应用 Client Secret |
| `TIKTOK_ACCESS_TOKEN` | TikTok 访问令牌（脚本自动刷新）|
| `TIKTOK_REFRESH_TOKEN` | TikTok 长期 Refresh Token |
| `TIKTOK_USE_SANDBOX` | `true` = 沙盒模式（草稿，不公开发布）|

---

## 注意事项

- YouTube 上传后默认**私有**，需手动在 YouTube Studio 公开
- TikTok 沙盒模式下视频以草稿形式保存到创作者草稿箱，不会公开发布
- 发布前请确认视频内容版权或已取得原作者授权
- Bilibili cookies 可提升访问稳定性（可选，配置到 `.env`）
