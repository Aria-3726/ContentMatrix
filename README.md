# ContentMatrix 🎮

**Pocomo 海外三方号内容工作流**

将 B站/抖音 的游戏内容自动化地 → 下载 → 转录 → AI配音 → 翻译 → 审核 → 发布到 YouTube

---

## Phase 1 工作流

```
B站搜索
  ↓ 质量过滤（播放量、时长、关键词相关性）
内容发现队列
  ↓ yt-dlp 下载
本地视频文件
  ↓ SiliconFlow SenseVoice 转录
中文字幕 + 转录文本
  ↓ DeepSeek-V3 本地化翻译
英文/日文/韩文 标题+描述+字幕
  ↓ Microsoft Edge TTS AI配音
英文语音 + 精确字幕时间戳
  ↓ 人工审核（可编辑、可预览视频）
  ↓ YouTube Data API v3（含字幕上传）
YouTube 私有视频（手动公开）
```

---

## 快速开始

### 1. 安装系统依赖

```bash
# macOS
brew install yt-dlp ffmpeg

# Ubuntu
apt install ffmpeg
pip install yt-dlp
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 API Key
```

### 3. YouTube OAuth2 初始配置（一次性）

```bash
# 1. Google Cloud Console → 创建项目 → 启用 YouTube Data API v3
# 2. 创建 OAuth2 Desktop 凭证 → 复制 Client ID / Secret 到 .env
# 3. 运行授权脚本：
npx tsx -r dotenv/config scripts/youtube-auth.ts
# 4. 将输出的 YOUTUBE_REFRESH_TOKEN 粘贴到 .env
```

### 4. 启动开发服务器

```bash
npm install
npm run dev
# 访问 http://localhost:3000
```

---

## 目录结构

```
ContentMatrix/
├── app/
│   ├── page.tsx              # 主控制台（搜索 + 任务队列）
│   ├── review/[id]/          # 内容审核 + 编辑页（视频预览、字幕编辑、封面截取）
│   └── api/
│       ├── scrape/           # B站搜索 → 创建任务
│       ├── proxy/image/      # B站缩略图代理
│       ├── jobs/             # 任务 CRUD
│       │   └── [id]/
│       │       ├── download/    # yt-dlp 下载
│       │       ├── transcribe/  # SenseVoice 转录
│       │       ├── translate/   # DeepSeek-V3 翻译
│       │       ├── dub/         # Edge TTS AI配音
│       │       ├── thumbnail/   # FFmpeg 封面截取
│       │       ├── video/       # 视频流式预览
│       │       └── publish/     # YouTube 上传（含字幕）
│       └── system-check/     # 环境检查
├── lib/
│   ├── scraper/bilibili.ts   # B站搜索 API（含关键词过滤）
│   ├── processor/
│   │   ├── downloader.ts     # yt-dlp 封装
│   │   ├── transcriber.ts    # SenseVoice 转录（带时间戳估算）
│   │   ├── translator.ts     # DeepSeek-V3 翻译
│   │   └── dubbing.ts        # Edge TTS 配音 + FFmpeg 音轨替换
│   └── publisher/youtube.ts  # YouTube Data API v3（视频+缩略图+字幕）
├── components/               # React UI 组件
├── prisma/schema.prisma      # 数据库 Schema (SQLite)
└── scripts/youtube-auth.ts   # YouTube OAuth2 初始化
```

---

## 任务状态机

```
DISCOVERED → DOWNLOADING → DOWNLOADED → TRANSCRIBING → TRANSCRIBED
           → TRANSLATING → TRANSLATED → DUBBING
           → REVIEW_PENDING → PUBLISHING → PUBLISHED
                                            ↓
                                          FAILED（任意阶段）
```

---

## Phase 2 路线图

- [ ] BullMQ 任务队列（并发多视频处理）
- [ ] 抖音支持
- [ ] FFmpeg 字幕烧录到视频（硬字幕）
- [ ] TikTok Content Posting API
- [ ] 账号健康分析 Dashboard
- [ ] AI 封面自动生成

---

## 注意事项

- 视频上传到 YouTube 后默认为**私有**状态，需手动公开
- 建议在发布前确认内容版权或取得原作者授权
- Bilibili cookies 可提升访问稳定性（可选）
