# Paper Digest Agent

Paper Digest Agent 是一个本地论文速递工具，用来每天搜集 arXiv / DBLP 论文，生成中文摘要，并通过本地静态阅读站和邮件推送给你。

当前默认研究方向是：

- `硬件体系结构主线`：AI 处理器、NPU/GPU/TPU、LLM accelerator、Transformer/Attention accelerator、LLM 训推系统、KV cache、PIM/近存、3D/chiplet、硬件友好量化等。
- `算法趋势观察`：LLM/Agent/多模态/后训练/对齐/世界模型等，用少量名额跟踪 AI 发展趋势。

默认每日推荐配额：

```text
硬件体系结构主线：最多 6 篇
算法趋势观察：最多 2 篇
```

## What's New / 功能更新记录

- **2026-05-06** — ![Actions](https://img.shields.io/badge/GitHub%20Actions-cloud--daily-blue?style=flat-square) ![Pages](https://img.shields.io/badge/Pages-static--reader-green?style=flat-square) ![Email](https://img.shields.io/badge/Email-secrets--based-orange?style=flat-square) **云端无人值守运行**：新增 GitHub Actions 工作流，每天 08:20（Asia/Shanghai）在云端采集论文、调用 OpenAI-compatible API 生成 harness 摘要、发送邮件，并把 `daily.json/papers.json` 状态提交回仓库；新增 GitHub Pages 部署工作流，把 `public/` 发布为可在线访问的静态阅读站，避免本机睡眠导致定时任务错过。
- **2026-05-04** — ![NEW](https://img.shields.io/badge/NEW-red?style=flat-square) ![Discovery](https://img.shields.io/badge/Discovery-unseen--first-blue?style=flat-square) ![Backfill](https://img.shields.io/badge/Backfill-auto-green?style=flat-square) ![Daily](https://img.shields.io/badge/Daily-more--new-orange?style=flat-square) **每日新论文发现策略升级**：采集流程改为“先和历史库/当天库去重，再从未推送候选里排序推荐”，避免 Top N 都是旧论文时漏掉后排新论文；当未推送论文不足 `PAPER_AGENT_MIN_NEW_PAPERS` 时，自动扩大 arXiv 时间窗和每条 query 数量进行 `daily-backfill` 补充发现，尽量保证每天都有新论文进入摘要与邮件流程。
- **2026-05-03** — ![Harness](https://img.shields.io/badge/Harness-paper--reader--v1-blue?style=flat-square) ![Motivation](https://img.shields.io/badge/Motivation-required-green?style=flat-square) ![Method](https://img.shields.io/badge/Method-required-purple?style=flat-square) ![Experiments](https://img.shields.io/badge/Experiments-required-orange?style=flat-square) ![PDF Cache](https://img.shields.io/badge/PDF%20Cache-local-blue?style=flat-square) ![Reader](https://img.shields.io/badge/Reader-enhanced-purple?style=flat-square) **论文日报工作流与 Codex 读论文 harness 升级**：新增 `harness/paper-reader-v1.md`、`harness/paper-digest.schema.json`、`npm run harness:prompt`、`npm run harness:validate`；把 `motivationZh/methodZh/experimentsZh` 设为硬门槛，要求具体问题、方法机制、实验设置/基线/指标/结果和证据来源，空泛或缺证据时标记 `workflow.digestStatus=failed`；同时支持可选 PDF 本地缓存、工作流状态、阅读站状态筛选/收藏/已读，避免把不可靠摘要发进邮件。

## 数据结构

项目维护两个 JSON 库：

```text
public/research-digest/daily.json   # 当天新论文工作区
public/research-digest/papers.json  # 历史论文库
public/research-digest/pdfs/        # 可选 PDF 本地缓存，默认不提交到 GitHub
```

工作方式：

1. 采集脚本只把当天新论文写入 `daily.json`。
2. 如果开启 PDF 缓存，脚本会下载 arXiv PDF 并把本地路径写入论文条目。
3. Codex 自动化或网页端只给 `daily.json` 里的未推送论文生成摘要。
4. 邮件脚本只发送 `daily.json` 里“未推送 + 已完成摘要”的论文。
5. 邮件发送成功后，论文会被标记为 `pushedAt/emailSentAt`，并合并进 `papers.json` 历史库。

这样可以避免每天重复推送历史论文。

## 1. 准备环境

需要：

- macOS / Linux / Windows WSL
- Node.js 18.17 或更高版本
- npm
- 可选：Codex Desktop，用于不花 API 费用生成摘要
- 可选：SMTP 邮箱授权码，用于邮件推送

检查 Node：

```bash
node --version
npm --version
```

如果 macOS 上没有 Node，可以用 Homebrew 安装：

```bash
brew install node
```

## 2. 克隆项目

```bash
git clone https://github.com/YouthLiuYS/PaperDigestAgent.git
cd PaperDigestAgent
```

这个项目没有第三方 npm 依赖，所以通常不需要 `npm install`。

## 3. 创建本地配置

复制配置模板：

```bash
cp .env.example .env.local
```

然后编辑 `.env.local`：

```bash
nano .env.local
```

`.env.local` 不会提交到 GitHub。它用于保存本地私密配置，比如 SMTP 授权码、API key、搜索主题等。

## 4. 配置搜索主题

`.env.example` 已经内置一套适合 AI 处理器/体系结构 + LLM 系统优化的主题词。

核心变量：

```bash
PAPER_AGENT_COLLECTION_MODE=all
PAPER_AGENT_DAILY_MAX_PAPERS=8
PAPER_AGENT_DAILY_PRIMARY_MAX_PAPERS=6
PAPER_AGENT_DAILY_TREND_MAX_PAPERS=2
PAPER_AGENT_MIN_NEW_PAPERS=5
PAPER_AGENT_BACKFILL_ENABLED=true
PAPER_AGENT_BACKFILL_DAYS=45
PAPER_AGENT_BACKFILL_MAX_PER_QUERY=24
PAPER_AGENT_CONFERENCE_YEARS=2025;2024;2023;2022
```

`PAPER_AGENT_MIN_NEW_PAPERS` 是每天希望尽量产出的未推送论文数量。若常规每日最新结果不够，agent 会启用 backfill：扩大 arXiv 近邻时间窗和每条 query 返回数量，并把补充发现标记为 `daily-backfill`。它仍然会和历史库去重，所以不会故意重复推送旧论文。

可选 PDF 缓存：

```bash
PAPER_AGENT_DOWNLOAD_PDFS=false
PAPER_AGENT_PDF_DIR=public/research-digest/pdfs
PAPER_AGENT_PDF_MAX_PER_RUN=12
```

默认关闭 PDF 缓存，因为下载 PDF 会让每日采集变慢。需要 Codex 更准确地提取作者单位时，可以临时开启：

```bash
node scripts/paper-agent.mjs --mode daily --no-ai --no-email --download-pdfs --pdf-max 6
```

如果你只想看每日最新论文，可以运行：

```bash
npm run papers:collect:daily
```

如果你想检索往年会议论文，可以运行：

```bash
npm run papers:collect:conference
```

完整模式会同时跑每日最新和往年会议：

```bash
npm run papers:collect
```

注意：DBLP 偶尔会慢或返回 `fetch failed`。这不会破坏已有数据，脚本会保留成功采集到的结果。

## 5. 首次试跑

先跑一个不发邮件、不调用 AI 的采集：

```bash
npm run papers:collect
```

更稳妥的首次测试可以只跑 daily：

```bash
node scripts/paper-agent.mjs --mode daily --no-ai --no-email --daily-max 5 --max-per-query 5
```

成功后会看到类似：

```text
Paper agent started.
Collected 8 candidate papers (...), 6 new.
Wrote 6 daily new papers to public/research-digest/daily.json.
Paper agent finished.
```

## 6. 启动本地阅读站

```bash
npm run serve
```

打开：

```text
http://127.0.0.1:4173/
```

页面会展示：

- 历史论文库
- 今日新论文
- 推荐通道标签
- 工作流状态和 PDF 缓存状态
- 收藏、已读、未读筛选
- 中文摘要字段
- 网页端摘要工作台

如果端口被占用，可以换端口：

```bash
PORT=4174 npm run serve
```

## 7. 生成中文摘要

你有三种方式。

### 方式 A：使用 Codex 自动化，推荐

让采集脚本只负责搜论文，让 Codex 每天处理 `daily.json`。

Codex 自动化任务说明可以写成：

```text
cd /path/to/PaperDigestAgent
npm run harness:prompt
```

把命令输出的完整 prompt 交给 Codex 自动化。这个 prompt 会按 `harness/paper-reader-v1.md` 约束 Codex：优先保证 `motivationZh`、`methodZh`、`experimentsZh` 的信息密度和证据来源；如果这三项空泛或缺证据，就把论文标成 `workflow.digestStatus=failed`。

Codex 写回 `daily.json` 后，建议检查：

```bash
npm run harness:validate
```

如果你想把校验结果写回 `workflow.digestStatus` 和 stats：

```bash
npm run harness:validate:write
```

推荐调度：

```text
08:20 采集论文
08:35 Codex 自动化根据 harness 生成摘要
08:45 npm run harness:validate
08:50 发送邮件
```

### 方式 B：使用本地网页端 + ChatGPT 网页

运行：

```bash
npm run serve
```

打开 `http://127.0.0.1:4173/`，在“网页端摘要工作台”里：

1. 点击“复制提示词”。
2. 粘贴到 ChatGPT 网页。
3. 把 ChatGPT 返回的 JSON 粘回工作台。
4. 点击“保存摘要”。

保存后会更新 `public/research-digest/daily.json`。

### 方式 C：使用 OpenAI-compatible API

如果你愿意让脚本直接调用 API，在 `.env.local` 配置：

```bash
PAPER_AGENT_AI_API_KEY=your-api-key
PAPER_AGENT_AI_MODEL=gpt-4o-mini
PAPER_AGENT_AI_API_URL=https://api.openai.com/v1/chat/completions
```

测试连接：

```bash
npm run ai:test
```

然后直接运行脚本即可。注意 API 调用会产生平台用量费用，ChatGPT Pro 会员不等于 API 免费额度。

## 8. 配置邮件推送

在 `.env.local` 里配置 SMTP。

通用示例：

```bash
PAPER_AGENT_EMAIL_ENABLED=true
PAPER_AGENT_SMTP_HOST=smtp.example.com
PAPER_AGENT_SMTP_PORT=465
PAPER_AGENT_SMTP_SECURE=true
PAPER_AGENT_SMTP_USER=paper-agent@example.com
PAPER_AGENT_SMTP_PASS=your-smtp-authorization-code
PAPER_AGENT_MAIL_FROM=Paper Agent <paper-agent@example.com>
PAPER_AGENT_MAIL_TO=reader@example.com
```

网易邮箱通常需要：

1. 在邮箱设置里开启 SMTP/IMAP 服务。
2. 生成“授权码”。
3. `PAPER_AGENT_SMTP_PASS` 填授权码，不要填登录密码。

网易企业邮箱常见端口是 SSL 465 或企业邮箱指定的 SSL 端口。以邮箱后台显示为准。

测试邮件阶段：

```bash
npm run papers:email
```

邮件脚本不会重新采集。它只读取 `daily.json` 中未推送且已完成摘要的论文。

如果没有新论文，会看到：

```text
Email skipped: no unpushed daily papers with completed summaries.
```

## 9. 推荐的每日手动流程

```bash
cd /path/to/PaperDigestAgent
npm run papers:collect
npm run serve
# 用 Codex 自动化或网页端生成 daily.json 的摘要
npm run papers:email
```

验证状态：

```bash
node -e "const fs=require('fs'); for (const f of ['public/research-digest/daily.json','public/research-digest/papers.json']) { const d=JSON.parse(fs.readFileSync(f,'utf8')); console.log(f, d.stats); }"
```

## 10. GitHub Actions 云端运行

如果希望电脑睡眠时也能工作，推荐使用 GitHub Actions。项目已内置两个工作流：

```text
.github/workflows/paper-agent.yml  # 每天采集、摘要、发邮件、提交 JSON 状态
.github/workflows/pages.yml        # 发布 public/ 为 GitHub Pages 静态阅读站
```

默认计划任务是每天 `00:20 UTC`，也就是北京时间 `08:20`。Actions 运行后会：

1. 读取仓库里的历史库 `public/research-digest/papers.json`。
2. 搜集当天新论文，并自动 backfill 补充未见过的论文。
3. 使用 OpenAI-compatible API 生成中文摘要、motivation、method、实验结果和作者单位。
4. 发送邮件。
5. 邮件成功后把论文标记为 `pushedAt/emailSentAt`，合并进历史库。
6. 把更新后的 `daily.json/papers.json` commit 回仓库。
7. 触发 GitHub Pages，把静态阅读站更新到线上。

注意：GitHub Actions 不能直接调用你本机的 Codex Desktop 或 ChatGPT 网页端。要做到云端全自动摘要和邮件，必须配置 OpenAI-compatible API key；如果不配置 API key，Actions 可以采集论文并提交 JSON，但邮件会因为没有可用摘要而跳过。

### 配置 Secrets

打开 GitHub 仓库：

```text
Settings -> Secrets and variables -> Actions
```

在 `Secrets` 里新增：

```text
PAPER_AGENT_AI_API_KEY       # OpenAI-compatible API key
PAPER_AGENT_SMTP_HOST        # SMTP 地址，例如 smtp.163.com 或企业邮箱后台给出的地址
PAPER_AGENT_SMTP_PORT        # 常见为 465
PAPER_AGENT_SMTP_SECURE      # true
PAPER_AGENT_SMTP_STARTTLS    # false 或 true，以邮箱后台为准
PAPER_AGENT_SMTP_USER        # 发件邮箱账号
PAPER_AGENT_SMTP_PASS        # 邮箱 SMTP 授权码，不是登录密码
PAPER_AGENT_MAIL_FROM        # Paper Agent <你的发件邮箱>
PAPER_AGENT_MAIL_TO          # 收件邮箱，多个用英文分号分隔
```

可选地，在 `Variables` 里新增：

```text
PAPER_AGENT_AI_MODEL=gpt-4o-mini
PAPER_AGENT_AI_API_URL=https://api.openai.com/v1/chat/completions
PAPER_AGENT_REQUIRE_AI=true
PAPER_AGENT_SITE_URL=https://YouthLiuYS.github.io/PaperDigestAgent/
```

`PAPER_AGENT_REQUIRE_AI=true` 会让 AI 摘要失败时直接标红失败，便于在 Actions 页面排查；如果你希望失败时保留 fallback 数据，可以不设置。

### 手动运行 Actions

在 GitHub 页面运行：

```text
Actions -> Paper Digest Agent -> Run workflow
```

也可以用 `gh`：

```bash
gh workflow run "Paper Digest Agent" -f collection_mode=daily -f send_email=true
gh run list --workflow "Paper Digest Agent"
```

如果你想手动补一次往年会议库：

```bash
gh workflow run "Paper Digest Agent" -f collection_mode=conference -f send_email=false
```

### 启用 GitHub Pages

打开：

```text
Settings -> Pages
```

把 Source 设为 `GitHub Actions`。第一次 `Deploy Reader Site` 成功后，阅读站通常会在这里：

```text
https://YouthLiuYS.github.io/PaperDigestAgent/
```

GitHub Pages 上的阅读站是静态只读版，可以查看论文库和摘要；“网页端摘要工作台”的保存功能仍然只适合本地 `npm run serve`，因为 Pages 没有本地写文件 API。

## 11. 设置每天定时运行

macOS / Linux 可以用 crontab：

```bash
crontab -e
```

示例，每天 08:20 采集，08:50 发送邮件：

```cron
SHELL=/bin/zsh
PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
20 8 * * * cd /path/to/PaperDigestAgent && /opt/homebrew/bin/node scripts/paper-agent.mjs --mode all --no-ai --no-email >> /path/to/PaperDigestAgent/paper-agent.log 2>&1
50 8 * * * cd /path/to/PaperDigestAgent && /opt/homebrew/bin/node scripts/paper-agent.mjs --email-only --send-email >> /path/to/PaperDigestAgent/paper-agent.log 2>&1
```

如果你用 Codex 自动化生成摘要，建议把 Codex 自动化放在 08:35 左右。

macOS nano 里保存退出：

```text
Ctrl + O   保存
Enter      确认文件名
Ctrl + X   退出
```

## 12. 常用命令

```bash
npm run papers:help              # 查看参数
npm run papers:collect           # 采集每日最新 + 往年会议，不调用 AI，不发邮件
npm run papers:collect:daily     # 只采集每日最新
npm run papers:collect:conference # 只采集往年会议
npm run papers:collect:pdf       # 只采集每日最新，并缓存可用 PDF
npm run papers:email             # 只发送 daily.json 中未推送且已摘要的新论文
npm run serve                    # 启动本地阅读站
npm run ai:test                  # 测试 OpenAI-compatible API
npm run harness:prompt           # 生成给 Codex 自动化的读论文 harness prompt
npm run harness:validate         # 检查 daily.json 是否满足 harness
npm run harness:validate:write   # 将 harness 校验状态写回 daily.json
```

自定义一次采集：

```bash
node scripts/paper-agent.mjs --mode daily --no-ai --no-email --daily-max 8 --daily-primary-max 6 --daily-trend-max 2 --max-per-query 5
```

如果想提高“每天都有新论文”的概率，可以临时扩大补充发现：

```bash
node scripts/paper-agent.mjs --mode daily --no-ai --no-email --min-new 6 --backfill-days 60 --backfill-max-per-query 32
```

带 PDF 缓存的采集：

```bash
node scripts/paper-agent.mjs --mode daily --no-ai --no-email --download-pdfs --pdf-max 6
```

## 13. 文件说明

```text
scripts/paper-agent.mjs              # 核心采集/去重/邮件脚本
scripts/serve.mjs                    # 本地静态站和摘要保存 API
scripts/test-ai.mjs                  # API 连通性测试
scripts/build-codex-harness-prompt.mjs # 生成 Codex 读论文 harness prompt
scripts/validate-digest-harness.mjs  # 校验 motivation/method/experiments 质量
harness/paper-reader-v1.md           # Codex 读论文协议
harness/paper-digest.schema.json     # digest 结构化输出 schema
public/index.html                    # 阅读站页面
public/app.js                        # 前端逻辑
public/styles.css                    # 样式
public/research-digest/daily.json    # 今日新论文工作区
public/research-digest/papers.json   # 历史库
public/research-digest/pdfs/         # 可选 PDF 缓存，默认忽略
.github/workflows/paper-agent.yml    # GitHub Actions 云端采集/摘要/邮件/提交状态
.github/workflows/pages.yml          # GitHub Pages 静态阅读站部署
.env.example                         # 配置模板
.env.local                           # 本地私密配置，不提交
```

## 14. 排错

### 127.0.0.1 拒绝连接

说明本地站点没启动。运行：

```bash
npm run serve
```

然后访问 `http://127.0.0.1:4173/`。

### 端口 4173 被占用

换端口：

```bash
PORT=4174 npm run serve
```

### arXiv 返回 503

arXiv 偶尔限流或维护。稍后重试即可。

### DBLP fetch failed

DBLP 搜索接口偶尔较慢。脚本会跳过失败查询，并保留已有数据。首次验证建议先跑：

```bash
npm run papers:collect:daily
```

### 邮件显示 SMTP settings are incomplete

检查 `.env.local` 是否配置：

```bash
PAPER_AGENT_SMTP_HOST
PAPER_AGENT_SMTP_PORT
PAPER_AGENT_SMTP_USER
PAPER_AGENT_SMTP_PASS
PAPER_AGENT_MAIL_FROM
PAPER_AGENT_MAIL_TO
```

### 邮件显示 no unpushed daily papers

说明 `daily.json` 里没有“未推送 + 已完成摘要”的论文。先运行采集，再让 Codex 或网页端补摘要：

```bash
npm run papers:collect
```

### API 测试 429 insufficient_quota

这是 OpenAI API 计费额度问题。ChatGPT Pro 会员不自动包含 API 免费额度。可以改用 Codex 自动化或网页端摘要流程。

### GitHub Actions 没有发邮件

先看 Actions 日志里的 `Run paper digest agent` 步骤：

- `Email skipped: SMTP settings are incomplete.`：SMTP Secrets 没配全。
- `Email skipped: no unpushed daily papers with completed summaries.`：没有可发送的“新论文 + 可用摘要”，通常是 API key 未配置或 AI 摘要失败。
- `AI API 401/429`：API key 无效、额度不足或模型不可用。
- `Email failed`：SMTP 地址、端口、授权码或发件人配置不对。

如果邮件已经成功发送，但下一天又重复发送同一批论文，通常是 Actions 没有成功把 `pushedAt/emailSentAt` commit 回仓库，需要检查 `Commit updated digest data` 步骤。

## 15. 安全提示

不要提交这些文件：

```text
.env.local
.env.local.save
paper-agent.log
public/research-digest/*.bak
public/research-digest/pdfs/
```

项目的 `.gitignore` 已经默认忽略它们。`.env.local` 里如果曾经写过真实 API key 或邮箱授权码，公开分享项目后建议轮换一次密钥。
