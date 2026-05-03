# Paper Digest Agent

一个独立的本地论文速递项目：每天从 arXiv 和 DBLP 搜集论文，生成中文摘要、motivation、method、实验结果和作者单位字段，写入本地静态阅读站，并可通过 SMTP 推送邮件。

数据现在拆成两个库：

- `public/research-digest/daily.json`：当天新搜集、尚未推送或刚推送的论文小库，Codex 自动化只处理这个文件。
- `public/research-digest/papers.json`：历史库，邮件发送成功后才把当天论文合并进去，用来防止重复推送。

推荐策略采用双通道：

- `硬件体系结构主线`：AI 处理器、NPU/GPU/TPU、体系结构、LLM 训推系统、KV cache、PIM/近存、硬件友好量化等，默认每天最多 6 篇。
- `算法趋势观察`：LLM/Agent/多模态/后训练/对齐等 AI 发展趋势，默认每天最多 2 篇，只作为辅助跟踪。

## 快速开始

1. 进入项目：
   `cd /Users/cyyoung/PaperDigestAgent`
2. 查看参数：
   `npm run papers:help`
3. 不调用 AI、不发邮件的试运行：
   `npm run papers:demo`
4. 采集当天新论文，不调用 AI、不发邮件：
   `npm run papers:collect`
5. 发送当天已完成摘要、尚未推送的新论文：
   `npm run papers:email`
6. 打开本地静态阅读站：
   `npm run serve` 后访问 `http://127.0.0.1:4173/`

## 环境变量

创建 `.env.local`。如果使用 Codex 自动化或网页端生成摘要，可以不配置 AI key；如果希望脚本直接调用 OpenAI-compatible API，再配置 `PAPER_AGENT_AI_API_KEY`：

```bash
PAPER_AGENT_AI_API_KEY=sk-...
PAPER_AGENT_AI_MODEL=gpt-4o-mini
PAPER_AGENT_ARXIV_QUERIES=(cat:cs.AR OR cat:cs.DC OR cat:cs.PF) AND (all:LLM OR all:transformer OR all:foundation OR all:language) AND (all:accelerator OR all:processor OR all:architecture OR all:hardware OR all:system OR all:serving OR all:training OR all:inference OR all:cache);(all:quantization OR all:compression OR all:pruning OR all:sparsity OR all:low-bit) AND (all:LLM OR all:transformer OR all:language) AND (all:hardware OR all:accelerator OR all:inference OR all:serving OR all:processor);(all:prefill OR all:decoding OR all:KV OR all:cache OR all:attention) AND (all:accelerator OR all:kernel OR all:compiler OR all:serving OR all:memory) AND (all:LLM OR all:transformer);(all:PIM OR all:near-memory OR all:HBM OR all:DRAM OR all:SRAM OR all:chiplet) AND (all:LLM OR all:transformer OR all:AI);(all:agent OR all:agents OR all:agentic OR all:reasoning OR all:post-training OR all:alignment OR all:multimodal OR all:world-model) AND (all:LLM OR all:foundation OR all:language)
PAPER_AGENT_DBLP_QUERIES=LLM accelerator architecture;large language model accelerator;LLM inference accelerator;transformer accelerator architecture;attention accelerator architecture;AI processor large language model;NPU large language model;GPU LLM inference optimization;LLM serving system optimization;large language model inference system;LLM training system optimization;hardware software co-design LLM;hardware aware LLM quantization;large language model quantization hardware;low bit LLM inference accelerator;sparsity LLM accelerator;KV cache optimization LLM;memory efficient LLM inference;near memory computing LLM;processing in memory transformer;chiplet AI accelerator;compiler optimization LLM inference;LLM reasoning agent;multimodal large language model;post-training LLM alignment
PAPER_AGENT_TARGET_THEMES=LLM accelerator architecture;large language model accelerator;LLM inference acceleration;transformer accelerator;attention accelerator;AI processor architecture;NPU for large language model;GPU LLM inference optimization;LLM serving system optimization;LLM training system optimization;hardware software co-design for LLM;hardware aware LLM quantization;large language model quantization hardware;low-bit LLM inference accelerator;sparsity acceleration for LLM;KV cache optimization;memory efficient LLM inference;near memory computing for LLM;processing in memory for transformer;chiplet AI accelerator;compiler optimization for LLM inference;agent hardware software co-design
PAPER_AGENT_CONFERENCE_VENUES=ISCA;MICRO;HPCA;ASPLOS;MLSys;OSDI;SOSP;USENIX ATC;SC;PPoPP;EuroSys;DAC;ICCAD;DATE;NeurIPS;ICML;ICLR;ACL;EMNLP
PAPER_AGENT_CONFERENCE_YEARS=2025;2024;2023;2022
PAPER_AGENT_COLLECTION_MODE=all
PAPER_AGENT_MAX_PAPERS=20
PAPER_AGENT_SITE_URL=http://127.0.0.1:4173/
PAPER_AGENT_DAILY_OUTPUT=public/research-digest/daily.json
```

如果要发邮件，再加入 SMTP 配置：

```bash
PAPER_AGENT_EMAIL_ENABLED=true
PAPER_AGENT_SMTP_HOST=smtp.example.com
PAPER_AGENT_SMTP_PORT=465
PAPER_AGENT_SMTP_SECURE=true
PAPER_AGENT_SMTP_USER=paper-agent@example.com
PAPER_AGENT_SMTP_PASS=your-smtp-password
PAPER_AGENT_MAIL_FROM=Paper Agent <paper-agent@example.com>
PAPER_AGENT_MAIL_TO=reader@example.com
```

## 配置文件

也可以复制 `paper-agent.config.example.json` 为 `paper-agent.config.json`，然后运行：

```bash
node scripts/paper-agent.mjs --config paper-agent.config.json --email-only --send-email
```

## 每天定时

本地 crontab 示例，每天 08:20 采集、08:50 发邮件：

```cron
SHELL=/bin/zsh
PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
20 8 * * * cd /Users/cyyoung/PaperDigestAgent && /opt/homebrew/bin/node scripts/paper-agent.mjs --mode all --no-ai --no-email >> /Users/cyyoung/PaperDigestAgent/paper-agent.log 2>&1
50 8 * * * cd /Users/cyyoung/PaperDigestAgent && /opt/homebrew/bin/node scripts/paper-agent.mjs --email-only --send-email >> /Users/cyyoung/PaperDigestAgent/paper-agent.log 2>&1
```

其中 `--mode all` 会同时运行“每日最新论文”和“往年会议论文”两类采集。

## 两类采集功能

Agent 支持两种采集档案：

- `daily-latest`：从 arXiv 最新投稿和 DBLP 主题搜索中搜集最新论文。
- `conference-archive`：按目标主题、会议名和年份，在 DBLP 往年会议论文中检索。

常用命令：

```bash
npm run papers:collect
npm run papers:collect:daily
npm run papers:collect:conference
```

也可以直接传参：

```bash
node scripts/paper-agent.mjs --mode conference --no-ai --no-email --theme "AI accelerator" --theme "LLM inference" --venue ISCA --venue MICRO --year 2025 --year 2024
```

关键环境变量：

```bash
PAPER_AGENT_COLLECTION_MODE=all
PAPER_AGENT_TARGET_THEMES=LLM accelerator architecture;large language model accelerator;LLM inference acceleration;transformer accelerator;attention accelerator;AI processor architecture;NPU for large language model;GPU LLM inference optimization;LLM serving system optimization;LLM training system optimization;hardware software co-design for LLM;hardware aware LLM quantization;large language model quantization hardware;low-bit LLM inference accelerator;sparsity acceleration for LLM;KV cache optimization;memory efficient LLM inference;near memory computing for LLM;processing in memory for transformer;chiplet AI accelerator;compiler optimization for LLM inference;agent hardware software co-design
PAPER_AGENT_CONFERENCE_VENUES=ISCA;MICRO;HPCA;ASPLOS;MLSys;OSDI;SOSP;USENIX ATC;SC;PPoPP;EuroSys;DAC;ICCAD;DATE;NeurIPS;ICML;ICLR;ACL;EMNLP
PAPER_AGENT_CONFERENCE_YEARS=2025;2024;2023;2022
PAPER_AGENT_DAILY_MAX_PAPERS=8
PAPER_AGENT_DAILY_PRIMARY_MAX_PAPERS=6
PAPER_AGENT_DAILY_TREND_MAX_PAPERS=2
PAPER_AGENT_CONFERENCE_MAX_PAPERS=16
PAPER_AGENT_CONFERENCE_MAX_PER_QUERY=3
PAPER_AGENT_CONFERENCE_MAX_QUERIES=120
```

## 输出位置

- 当天新论文：`public/research-digest/daily.json`
- 历史论文库：`public/research-digest/papers.json`
- 阅读站入口：`public/index.html`
- 采集脚本：`scripts/paper-agent.mjs`

## 使用网页端生成摘要，不调用 AI API

如果不想使用 OpenAI API，可以让脚本只负责采集和发邮件，本地网页负责整理提示词和保存 ChatGPT 网页返回的 JSON。

每日流程：

```bash
npm run papers:collect
npm run serve
# 在 http://127.0.0.1:4173/ 的“网页端摘要工作台”复制提示词
# 将提示词粘贴到 ChatGPT 网页
# 将 ChatGPT 返回的 JSON 粘回摘要工作台并保存
npm run papers:email
```

`papers:collect` 不调用 AI API，也不发送邮件，只更新 `daily.json`。`papers:email` 不重新采集，只发送 `daily.json` 中尚未推送且已完成摘要的新论文；发送成功后会把它们标记为已推送，并合并进历史库 `papers.json`。
