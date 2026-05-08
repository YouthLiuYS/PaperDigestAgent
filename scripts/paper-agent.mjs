#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

await loadEnvFile(path.join(repoRoot, ".env.local"));
await loadEnvFile(path.join(repoRoot, ".env"));

const DEFAULT_ARXIV_QUERIES = [
  "(cat:cs.AR OR cat:cs.DC OR cat:cs.PF) AND (all:LLM OR all:transformer OR all:foundation OR all:language) AND (all:accelerator OR all:processor OR all:architecture OR all:hardware OR all:system OR all:serving OR all:training OR all:inference OR all:cache)",
  "(all:quantization OR all:compression OR all:pruning OR all:sparsity OR all:low-bit) AND (all:LLM OR all:transformer OR all:language) AND (all:hardware OR all:accelerator OR all:inference OR all:serving OR all:processor)",
  "(all:prefill OR all:decoding OR all:KV OR all:cache OR all:attention) AND (all:accelerator OR all:kernel OR all:compiler OR all:serving OR all:memory) AND (all:LLM OR all:transformer)",
  "(all:PIM OR all:near-memory OR all:HBM OR all:DRAM OR all:SRAM OR all:chiplet) AND (all:LLM OR all:transformer OR all:AI)",
  "(all:agent OR all:agents OR all:agentic OR all:reasoning OR all:post-training OR all:alignment OR all:multimodal OR all:world-model) AND (all:LLM OR all:foundation OR all:language)"
];
const DEFAULT_DBLP_QUERIES = [
  "LLM accelerator architecture",
  "large language model accelerator",
  "LLM inference accelerator",
  "transformer accelerator architecture",
  "attention accelerator architecture",
  "AI processor large language model",
  "NPU large language model",
  "GPU LLM inference optimization",
  "LLM serving system optimization",
  "large language model inference system",
  "LLM training system optimization",
  "hardware software co-design LLM",
  "hardware aware LLM quantization",
  "large language model quantization hardware",
  "low bit LLM inference accelerator",
  "sparsity LLM accelerator",
  "KV cache optimization LLM",
  "memory efficient LLM inference",
  "near memory computing LLM",
  "processing in memory transformer",
  "chiplet AI accelerator",
  "compiler optimization LLM inference",
  "LLM reasoning agent",
  "multimodal large language model",
  "post-training LLM alignment"
];
const DEFAULT_TARGET_THEMES = [
  "LLM accelerator architecture",
  "large language model accelerator",
  "LLM inference acceleration",
  "transformer accelerator",
  "attention accelerator",
  "AI processor architecture",
  "NPU for large language model",
  "GPU LLM inference optimization",
  "LLM serving system optimization",
  "LLM training system optimization",
  "hardware software co-design for LLM",
  "hardware aware LLM quantization",
  "large language model quantization hardware",
  "low-bit LLM inference accelerator",
  "sparsity acceleration for LLM",
  "KV cache optimization",
  "memory efficient LLM inference",
  "near memory computing for LLM",
  "processing in memory for transformer",
  "chiplet AI accelerator",
  "compiler optimization for LLM inference",
  "agent hardware software co-design"
];
const DEFAULT_CONFERENCE_VENUES = [
  "ISCA",
  "MICRO",
  "HPCA",
  "ASPLOS",
  "MLSys",
  "OSDI",
  "SOSP",
  "USENIX ATC",
  "SC",
  "PPoPP",
  "EuroSys",
  "DAC",
  "ICCAD",
  "DATE",
  "NeurIPS",
  "ICML",
  "ICLR",
  "ACL",
  "EMNLP"
];
const FALLBACK_DIGEST_MARKERS = [
  "AI 摘要未生成",
  "命令行启用了 --no-ai",
  "AI 调用失败",
  "未配置 PAPER_AGENT_AI_API_KEY"
];
const TRACK_LABELS = {
  "hardware-primary": "硬件体系结构主线",
  "algorithm-trend": "算法趋势观察",
  "off-topic": "低相关"
};
const HARNESS_VERSION = "paper-reader-v1";
const HARDWARE_KEYWORDS = [
  ["accelerator", 5],
  ["processor", 5],
  ["npu", 5],
  ["tpu", 4],
  ["gpu", 3],
  ["fpga", 5],
  ["asic", 5],
  ["chiplet", 5],
  ["chip", 4],
  ["architecture", 4],
  ["microarchitecture", 5],
  ["hardware", 5],
  ["systolic", 5],
  ["dataflow", 4],
  ["near-memory", 5],
  ["near memory", 5],
  ["processing in memory", 5],
  ["in-memory", 4],
  ["pim", 5],
  ["hbm", 4],
  ["dram", 3],
  ["sram", 3],
  ["kv cache", 4],
  ["attention accelerator", 6],
  ["transformer accelerator", 6],
  ["serving system", 4],
  ["inference system", 4],
  ["compiler", 3],
  ["kernel", 3],
  ["throughput", 2],
  ["latency", 2],
  ["energy", 3],
  ["power", 2],
  ["quantization", 4],
  ["low-bit", 4],
  ["low bit", 4],
  ["sparsity", 3],
  ["pruning", 2],
  ["compression", 2],
  ["outlier", 2]
];
const MODEL_CORE_KEYWORDS = [
  ["large language model", 5],
  ["language model", 4],
  ["llm", 5],
  ["transformer", 4],
  ["foundation model", 4],
  ["foundation", 2],
  ["vision-language", 3],
  ["vision language", 3],
  ["vla", 3],
  ["multimodal", 3],
  ["agentic", 3],
  ["agent", 2],
  ["world model", 2]
];
const ALGORITHM_TREND_KEYWORDS = [
  ["post-training", 4],
  ["reinforcement learning", 3],
  ["alignment", 3],
  ["reasoning", 3],
  ["chain-of-thought", 3],
  ["cot", 2],
  ["agentic", 3],
  ["agent", 2],
  ["world model", 3],
  ["vision-language-action", 4],
  ["vla", 3],
  ["multimodal", 3],
  ["visual generation", 2],
  ["diffusion", 2],
  ["safety", 2],
  ["elicitation", 2]
];
const OFF_TOPIC_KEYWORDS = [
  "pinn",
  "physics-informed",
  "differential equation",
  "poisson",
  "maxwell",
  "fluid dynamics",
  "thermal processing",
  "point charge",
  "wavelet-based"
];
const CONFERENCE_VENUE_ALIASES = {
  "USENIX ATC": ["USENIX ATC", "USENIX Annual Technical Conference"],
  "NeurIPS": ["NeurIPS", "NIPS"],
  "ISCA": ["ISCA"],
  "MICRO": ["MICRO"],
  "HPCA": ["HPCA"],
  "ASPLOS": ["ASPLOS"],
  "MLSys": ["MLSys"],
  "OSDI": ["OSDI"],
  "SOSP": ["SOSP"],
  "SC": ["SC", "Supercomputing"],
  "PPoPP": ["PPoPP", "PPOPP"],
  "EuroSys": ["EuroSys"],
  "DAC": ["DAC"],
  "ICCAD": ["ICCAD"],
  "DATE": ["DATE"],
  "ICML": ["ICML"],
  "ICLR": ["ICLR"],
  "CVPR": ["CVPR"],
  "ACL": ["ACL"],
  "EMNLP": ["EMNLP"]
};

const configuredDblpQueries = listFromEnv("PAPER_AGENT_DBLP_QUERIES") ?? DEFAULT_DBLP_QUERIES;

const DEFAULT_CONFIG = {
  collectionMode: process.env.PAPER_AGENT_COLLECTION_MODE ?? "all",
  daysBack: numberFromEnv("PAPER_AGENT_DAYS_BACK", 7),
  maxPerQuery: numberFromEnv("PAPER_AGENT_MAX_PER_QUERY", 8),
  maxPapers: numberFromEnv("PAPER_AGENT_MAX_PAPERS", 12),
  dailyMaxPapers: numberFromEnv("PAPER_AGENT_DAILY_MAX_PAPERS", numberFromEnv("PAPER_AGENT_MAX_PAPERS", 12)),
  dailyPrimaryMaxPapers: numberFromEnv("PAPER_AGENT_DAILY_PRIMARY_MAX_PAPERS", 6),
  dailyTrendMaxPapers: numberFromEnv("PAPER_AGENT_DAILY_TREND_MAX_PAPERS", 2),
  minNewPapers: numberFromEnv("PAPER_AGENT_MIN_NEW_PAPERS", 5),
  backfillEnabled: boolFromEnv("PAPER_AGENT_BACKFILL_ENABLED", true),
  backfillDays: numberFromEnv("PAPER_AGENT_BACKFILL_DAYS", 45),
  backfillMaxPerQuery: numberFromEnv("PAPER_AGENT_BACKFILL_MAX_PER_QUERY", 24),
  conferenceMaxPapers: numberFromEnv("PAPER_AGENT_CONFERENCE_MAX_PAPERS", 12),
  conferenceMaxPerQuery: numberFromEnv("PAPER_AGENT_CONFERENCE_MAX_PER_QUERY", 3),
  conferenceMaxQueries: numberFromEnv("PAPER_AGENT_CONFERENCE_MAX_QUERIES", 40),
  archiveLimit: numberFromEnv("PAPER_AGENT_ARCHIVE_LIMIT", 240),
  arxivQueries: listFromEnv("PAPER_AGENT_ARXIV_QUERIES") ?? DEFAULT_ARXIV_QUERIES,
  dblpQueries: configuredDblpQueries,
  targetThemes: listFromEnv("PAPER_AGENT_TARGET_THEMES") ?? DEFAULT_TARGET_THEMES,
  conferenceVenues: listFromEnv("PAPER_AGENT_CONFERENCE_VENUES") ?? DEFAULT_CONFERENCE_VENUES,
  conferenceYears: yearsFromEnv("PAPER_AGENT_CONFERENCE_YEARS") ?? defaultConferenceYears(),
  outputPath: process.env.PAPER_AGENT_OUTPUT ?? "public/research-digest/papers.json",
  dailyOutputPath: process.env.PAPER_AGENT_DAILY_OUTPUT ?? "public/research-digest/daily.json",
  siteUrl: process.env.PAPER_AGENT_SITE_URL ?? defaultSiteUrl(),
  pdf: {
    enabled: boolFromEnv("PAPER_AGENT_DOWNLOAD_PDFS", false),
    directory: process.env.PAPER_AGENT_PDF_DIR ?? "public/research-digest/pdfs",
    maxPerRun: numberFromEnv("PAPER_AGENT_PDF_MAX_PER_RUN", 12)
  },
  ai: {
    apiUrl: normalizeAiApiUrl(process.env.PAPER_AGENT_AI_API_URL ?? process.env.OPENAI_BASE_URL),
    apiKey: process.env.PAPER_AGENT_AI_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    model: process.env.PAPER_AGENT_AI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    requireAi: boolFromEnv("PAPER_AGENT_REQUIRE_AI", false)
  },
  email: {
    enabled: boolFromEnv("PAPER_AGENT_EMAIL_ENABLED", false),
    host: process.env.PAPER_AGENT_SMTP_HOST ?? "",
    port: numberFromEnv("PAPER_AGENT_SMTP_PORT", 0),
    secure: boolFromEnv("PAPER_AGENT_SMTP_SECURE", false),
    starttls: boolFromEnv("PAPER_AGENT_SMTP_STARTTLS", true),
    user: process.env.PAPER_AGENT_SMTP_USER ?? "",
    pass: process.env.PAPER_AGENT_SMTP_PASS ?? "",
    from: process.env.PAPER_AGENT_MAIL_FROM ?? "",
    to: listFromEnv("PAPER_AGENT_MAIL_TO") ?? [],
    emailOnEmpty: boolFromEnv("PAPER_AGENT_EMAIL_ON_EMPTY", false)
  }
};

const cli = parseArgs(process.argv.slice(2));

if (cli.help) {
  printHelp();
  process.exit(0);
}

const fileConfig = cli.configPath ? await readJsonIfExists(resolveFromRoot(cli.configPath)) : {};
const config = normalizeConfig(mergeConfig(DEFAULT_CONFIG, fileConfig, cli));

try {
  await run(config);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

async function run(config) {
  console.log("Paper agent started.");
  console.log(`Collection mode: ${config.collectionMode}`);
  if (cli.emailOnly) {
    console.log("Collection disabled for email-only mode.");
  } else if (isDailyMode(config)) {
    console.log(`Daily arXiv queries: ${config.arxivQueries.join(" | ")}`);
    console.log(`Daily DBLP queries: ${config.dblpQueries.join(" | ")}`);
  }
  if (!cli.emailOnly && isConferenceMode(config)) {
    console.log(`Conference themes: ${config.targetThemes.join(" | ")}`);
    console.log(`Conference venues: ${config.conferenceVenues.join(" | ")}`);
    console.log(`Conference years: ${config.conferenceYears.join(" | ")}`);
  }

  const historyDigest = await readDigest(config.outputPath);
  const historyPapers = Array.isArray(historyDigest.papers) ? historyDigest.papers : [];
  const dailyDigest = await readDigest(config.dailyOutputPath);
  const digestDate = cli.digestDate ?? (cli.emailOnly && dailyDigest.digestDate ? dailyDigest.digestDate : localDateKey());
  const existingDailyPapers = getDailyPapersForDate(dailyDigest, digestDate);
  let activeDailyDigest = buildDailyDigest(config, existingDailyPapers, digestDate, {
    collected: dailyDigest.stats?.collected ?? 0,
    dailyCount: dailyDigest.stats?.dailyCandidates ?? 0,
    conferenceCount: dailyDigest.stats?.conferenceCandidates ?? 0,
    backfillCount: dailyDigest.stats?.backfillCandidates ?? 0,
    rawCandidates: dailyDigest.stats?.rawCandidates ?? dailyDigest.stats?.collected ?? 0,
    newlyAdded: dailyDigest.stats?.newlyAdded ?? 0
  });

  if (cli.emailOnly) {
    console.log(`Email-only mode: loaded ${existingDailyPapers.length} daily papers from ${config.dailyOutputPath}.`);
    console.log(`History library has ${historyPapers.length} papers at ${config.outputPath}.`);
  } else {
    const knownIndex = buildExistingIndex([...historyPapers, ...existingDailyPapers]);
    const collection = await collectPapers(config, knownIndex);
    const candidates = collection.candidates;

    const newCandidates = candidates.filter((paper) => !findExistingPaper(paper, knownIndex));
    console.log(
      `Collected ${collection.rawCandidates} candidate papers (${collection.daily.length} daily, ${collection.conference.length} conference, ${collection.backfill.length} backfill), ${newCandidates.length} new selected.`
    );

    const enrichedNew = [];
    const pdfState = { downloaded: 0 };
    for (const paper of newCandidates) {
      const withPdf = await enrichPaperWithPdf(paper, config, pdfState);
      enrichedNew.push(await enrichPaperWithAi(withPdf, config));
    }

    const dailyPapers = sortPapersForDigest(dedupePapers([...existingDailyPapers, ...enrichedNew]));
    activeDailyDigest = buildDailyDigest(config, dailyPapers, digestDate, {
      collected: candidates.length,
      dailyCount: collection.daily.length,
      conferenceCount: collection.conference.length,
      backfillCount: collection.backfill.length,
      rawCandidates: collection.rawCandidates,
      newlyAdded: enrichedNew.length
    });

    await writeDigest(config.dailyOutputPath, activeDailyDigest);
    console.log(`Wrote ${dailyPapers.length} daily new papers to ${config.dailyOutputPath}.`);
    console.log(`History library remains ${historyPapers.length} papers at ${config.outputPath}.`);
  }

  const shouldEmail = config.email.enabled || cli.sendEmail;
  const shouldSkipEmail = cli.noEmail;
  if (shouldEmail && !shouldSkipEmail) {
    await sendDailyDigestEmail(config, activeDailyDigest, historyDigest);
  }

  console.log("Paper agent finished.");
}

async function collectPapers(config, knownIndex = null) {
  const dailyPool = isDailyMode(config)
    ? dedupePapers([
      ...(await collectArxivPapers(config)),
      ...(await collectDblpPapers(config))
    ])
    : [];

  const conferencePool = isConferenceMode(config)
    ? dedupePapers(await collectConferenceArchivePapers(config))
    : [];

  const daily = isDailyMode(config)
    ? selectRecommendedPapers(filterUnseenPapers(dailyPool, knownIndex), config.dailyMaxPapers, config)
    : [];

  const conference = isConferenceMode(config)
    ? selectRecommendedPapers(filterUnseenPapers(conferencePool, knownIndex, daily), config.conferenceMaxPapers, config)
    : [];

  const selected = dedupePapers([...daily, ...conference]);
  const backfill = config.backfillEnabled && isDailyMode(config) && selected.length < config.minNewPapers
    ? selectRecommendedPapers(
      filterUnseenPapers(await collectBackfillPapers(config), knownIndex, selected),
      Math.max(config.minNewPapers, config.dailyMaxPapers) - selected.length,
      config
    )
    : [];

  return {
    daily,
    conference,
    backfill,
    rawCandidates: dailyPool.length + conferencePool.length,
    candidates: sortPapersByDate(dedupePapers([...selected, ...backfill]))
  };
}

async function collectBackfillPapers(config) {
  const backfillConfig = {
    ...config,
    daysBack: Math.max(config.daysBack, config.backfillDays),
    maxPerQuery: Math.max(config.maxPerQuery, config.backfillMaxPerQuery)
  };
  console.log(`Backfill enabled: expanding daily search to ${backfillConfig.daysBack} days and ${backfillConfig.maxPerQuery} results/query.`);
  return dedupePapers([
    ...(await collectArxivPapers(backfillConfig, "daily-backfill")),
    ...(await collectDblpPapers(backfillConfig, "daily-backfill"))
  ]);
}

function filterUnseenPapers(papers, knownIndex, selected = []) {
  const selectedIds = new Set(selected.map((paper) => paper.id).filter(Boolean));
  const selectedTitles = new Set(selected.map((paper) => titleKey(paper.title)).filter(Boolean));
  return papers.filter((paper) => {
    if (knownIndex && findExistingPaper(paper, knownIndex)) {
      return false;
    }
    if (selectedIds.has(paper.id) || selectedTitles.has(titleKey(paper.title))) {
      return false;
    }
    return true;
  });
}

function selectRecommendedPapers(papers, limit, config) {
  const annotated = papers.map(annotateRecommendation).sort(compareRecommendation);
  const primary = annotated.filter((paper) => paper.recommendationTrack === "hardware-primary");
  const trend = annotated.filter((paper) => paper.recommendationTrack === "algorithm-trend");
  const fallback = annotated.filter((paper) => paper.recommendationTrack !== "hardware-primary" && paper.recommendationTrack !== "algorithm-trend");
  const selected = [];
  const pushUnique = (paper) => {
    if (selected.length >= limit) {
      return;
    }
    if (!selected.some((item) => item.id === paper.id || titleKey(item.title) === titleKey(paper.title))) {
      selected.push(paper);
    }
  };

  primary.slice(0, config.dailyPrimaryMaxPapers).forEach(pushUnique);
  trend.slice(0, config.dailyTrendMaxPapers).forEach(pushUnique);
  primary.slice(config.dailyPrimaryMaxPapers).forEach(pushUnique);
  trend.slice(config.dailyTrendMaxPapers).forEach(pushUnique);

  if (selected.length === 0) {
    fallback.forEach(pushUnique);
  }

  return selected;
}

function annotateRecommendation(paper) {
  const classification = classifyRecommendation(paper);
  return {
    ...paper,
    recommendationTrack: classification.track,
    recommendationLabel: TRACK_LABELS[classification.track] ?? classification.track,
    recommendationScore: classification.score,
    relevanceReason: classification.reason
  };
}

function classifyRecommendation(paper) {
  const text = paperSearchText(paper);
  const hardwareScore = keywordScore(text, HARDWARE_KEYWORDS);
  const coreScore = keywordScore(text, MODEL_CORE_KEYWORDS);
  const trendScore = keywordScore(text, ALGORITHM_TREND_KEYWORDS);
  const venueBoost = paper.collectionTypes?.includes("conference-archive") || paper.collectionType === "conference-archive" ? 3 : 0;
  const offTopic = OFF_TOPIC_KEYWORDS.some((keyword) => text.includes(keyword));

  if (offTopic && hardwareScore < 4 && coreScore < 3) {
    return {
      track: "off-topic",
      score: Math.max(0, hardwareScore + trendScore - 8),
      reason: "命中科学机器学习/物理仿真等低相关主题"
    };
  }

  if (hardwareScore + venueBoost >= 5 && (coreScore >= 2 || venueBoost > 0)) {
    return {
      track: "hardware-primary",
      score: hardwareScore * 2 + coreScore + venueBoost + trendScore * 0.25,
      reason: "命中 AI 处理器、体系结构、量化、训推系统或内存/缓存优化主题"
    };
  }

  if (trendScore >= 3 && coreScore >= 2) {
    return {
      track: "algorithm-trend",
      score: trendScore + coreScore * 0.8 + hardwareScore * 0.25,
      reason: "命中 LLM/Agent/多模态/后训练等算法趋势主题"
    };
  }

  if (hardwareScore >= 5) {
    return {
      track: "hardware-primary",
      score: hardwareScore * 1.5 + coreScore,
      reason: "命中硬件、体系结构或系统优化关键词"
    };
  }

  return {
    track: "off-topic",
    score: hardwareScore + trendScore + coreScore * 0.5,
    reason: "未达到硬件主线或算法趋势配额的相关性阈值"
  };
}

function compareRecommendation(a, b) {
  return (b.recommendationScore ?? 0) - (a.recommendationScore ?? 0) || paperTime(b) - paperTime(a);
}

function sortPapersForDigest(papers) {
  return [...papers].sort(compareDigestPriority);
}

function compareDigestPriority(a, b) {
  return recommendationTrackRank(a) - recommendationTrackRank(b)
    || (b.recommendationScore ?? 0) - (a.recommendationScore ?? 0)
    || paperTime(b) - paperTime(a);
}

function recommendationTrackRank(paper) {
  if (paper.recommendationTrack === "hardware-primary") {
    return 0;
  }
  if (paper.recommendationTrack === "algorithm-trend") {
    return 1;
  }
  if (paper.recommendationTrack === "off-topic") {
    return 3;
  }
  return 2;
}

function keywordScore(text, weightedKeywords) {
  return weightedKeywords.reduce((score, [keyword, weight]) => score + (text.includes(keyword) ? weight : 0), 0);
}

function paperSearchText(paper) {
  return normalizeWhitespace([
    paper.title,
    paper.abstract,
    paper.affiliations?.join(" "),
    paper.authorAffiliations?.map((item) => `${item.name} ${item.affiliation}`).join(" "),
    paper.venue,
    paper.source,
    paper.categories?.join(" "),
    paper.matchedQuery,
    paper.matchedQueries?.join(" "),
    paper.targetTheme,
    paper.targetThemes?.join(" "),
    paper.conferenceVenue,
    paper.conferenceVenues?.join(" ")
  ].join(" ")).toLowerCase();
}

async function collectArxivPapers(config, collectionType = "daily-latest") {
  const papers = [];
  const cutoff = Date.now() - config.daysBack * 24 * 60 * 60 * 1000;

  for (const query of config.arxivQueries) {
    try {
      const params = new URLSearchParams({
        search_query: query,
        start: "0",
        max_results: String(config.maxPerQuery),
        sortBy: "submittedDate",
        sortOrder: "descending"
      });
      const url = `https://export.arxiv.org/api/query?${params.toString()}`;
      const xml = await fetchText(url);
      const queryPapers = parseArxivFeed(xml)
        .filter((paper) => {
          const published = Date.parse(paper.published);
          return Number.isNaN(published) || published >= cutoff;
        })
        .map((paper) => tagPaper(paper, {
          collectionType,
          matchedQuery: query
        }));

      papers.push(...queryPapers);
    } catch (error) {
      console.warn(`arXiv query skipped (${query}): ${formatError(error)}`);
    }

    await sleep(1200);
  }

  return papers;
}

async function collectDblpPapers(config, collectionType = "daily-latest") {
  const papers = [];

  for (const query of config.dblpQueries) {
    try {
      const params = new URLSearchParams({
        q: query,
        format: "json",
        h: String(config.maxPerQuery)
      });
      const url = `https://dblp.org/search/publ/api?${params.toString()}`;
      const json = await fetchJson(url);
      papers.push(...parseDblpResults(json).map((paper) => tagPaper(paper, {
        collectionType,
        matchedQuery: query
      })));
    } catch (error) {
      console.warn(`DBLP query skipped (${query}): ${formatError(error)}`);
    }

    await sleep(250);
  }

  return papers;
}

async function collectConferenceArchivePapers(config) {
  const papers = [];
  const queries = buildConferenceQueries(config).slice(0, config.conferenceMaxQueries);

  console.log(`Conference archive queries: ${queries.length}`);

  for (const query of queries) {
    try {
      const params = new URLSearchParams({
        q: query.query,
        format: "json",
        h: String(config.conferenceMaxPerQuery)
      });
      const url = `https://dblp.org/search/publ/api?${params.toString()}`;
      const json = await fetchJson(url);
      const queryPapers = parseDblpResults(json)
        .filter((paper) => matchesConferenceVenue(paper, query.venue))
        .map((paper) => tagPaper(paper, {
          collectionType: "conference-archive",
          matchedQuery: query.query,
          targetTheme: query.theme,
          conferenceVenue: query.venue,
          conferenceYear: query.year
        }));

      papers.push(...queryPapers);
    } catch (error) {
      console.warn(`Conference query skipped (${query.query}): ${formatError(error)}`);
    }

    await sleep(350);
  }

  return papers;
}

async function enrichPaperWithPdf(paper, config, state) {
  if (!config.pdf.enabled || !paper.pdfUrl) {
    return normalizePdfMetadata(paper);
  }

  if (state.downloaded >= config.pdf.maxPerRun) {
    return {
      ...normalizePdfMetadata(paper),
      pdfStatus: paper.pdfStatus ?? "skipped",
      pdfError: paper.pdfError ?? `本次 PDF 缓存数已达到 ${config.pdf.maxPerRun} 篇上限`
    };
  }

  const relativePath = normalizeRelativePath(path.join(config.pdf.directory, pdfFileNameForPaper(paper)));
  const fullPath = resolveFromRoot(relativePath);
  const localPdfUrl = publicUrlForRelativePath(relativePath);

  try {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    if (!(await fileExists(fullPath))) {
      const response = await fetchWithRetry(paper.pdfUrl, {
        headers: {
          "Accept": "application/pdf",
          "User-Agent": "SteelWebPaperAgent/1.0 (research digest; contact configured by user)"
        }
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.subarray(0, 5).toString("utf8").startsWith("%PDF")) {
        throw new Error("下载结果不像 PDF 文件");
      }
      await fs.writeFile(fullPath, buffer);
      state.downloaded += 1;
    }

    return {
      ...paper,
      pdfStatus: "downloaded",
      pdfDownloadedAt: nowIso(),
      localPdfPath: relativePath,
      localPdfUrl
    };
  } catch (error) {
    return {
      ...paper,
      pdfStatus: "failed",
      pdfError: formatError(error),
      localPdfPath: relativePath,
      localPdfUrl
    };
  }
}

function buildConferenceQueries(config) {
  const queries = [];

  for (const theme of config.targetThemes) {
    for (const venue of config.conferenceVenues) {
      for (const year of config.conferenceYears) {
        queries.push({
          theme,
          venue,
          year,
          query: normalizeWhitespace(`${theme} ${venue} ${year}`)
        });
      }
    }
  }

  return queries;
}

function matchesConferenceVenue(paper, venue) {
  const aliases = CONFERENCE_VENUE_ALIASES[venue] ?? [venue];
  const haystack = normalizeWhitespace(paper.venue || "");
  return aliases.some((alias) => new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(alias)}([^A-Za-z0-9]|$)`, "i").test(haystack));
}

function parseArxivFeed(xml) {
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/g) ?? [];

  return entries.map((entry) => {
    const idUrl = textFromXml(entry, "id");
    const rawArxivId = idUrl.split("/abs/").at(-1) ?? idUrl;
    const arxivId = rawArxivId.replace(/v\d+$/, "");
    const links = [...entry.matchAll(/<link\b([^>]*)\/?>/g)].map((match) => parseXmlAttributes(match[1]));
    const pdfLink = links.find((link) => link.title === "pdf" || link.type === "application/pdf")?.href;
    const categories = [...entry.matchAll(/<category\b([^>]*)\/?>/g)]
      .map((match) => parseXmlAttributes(match[1]).term)
      .filter(Boolean);
    const authorEntries = parseArxivAuthors(entry);
    const authorAffiliations = authorEntries
      .filter((author) => author.affiliation)
      .map((author) => ({ name: author.name, affiliation: author.affiliation }));

    return {
      id: `arxiv:${arxivId}`,
      source: "arXiv",
      title: normalizeWhitespace(textFromXml(entry, "title")),
      authors: authorEntries.map((author) => author.name).filter(Boolean),
      authorAffiliations,
      affiliations: uniqueList(authorAffiliations.map((author) => author.affiliation)),
      abstract: normalizeWhitespace(textFromXml(entry, "summary")),
      venue: "arXiv",
      published: textFromXml(entry, "published"),
      updated: textFromXml(entry, "updated"),
      url: idUrl,
      pdfUrl: pdfLink,
      categories,
      collectedAt: nowIso(),
      firstSeenAt: nowIso(),
      lastSeenAt: nowIso()
    };
  });
}

function parseArxivAuthors(entry) {
  return [...entry.matchAll(/<author>([\s\S]*?)<\/author>/g)].map((match) => ({
    name: normalizeWhitespace(textFromXml(match[1], "name")),
    affiliation: normalizeWhitespace(textFromXml(match[1], "arxiv:affiliation") || textFromXml(match[1], "affiliation"))
  })).filter((author) => author.name);
}

function parseDblpResults(json) {
  const hits = asArray(json?.result?.hits?.hit);

  return hits.map((hit) => {
    const info = hit?.info ?? {};
    const title = normalizeWhitespace(decodeXml(stripTags(info.title ?? ""))).replace(/\.$/, "");
    const authors = normalizeDblpAuthors(info.authors?.author);
    const ee = firstValue(info.ee);
    const doi = firstValue(info.doi);
    const key = firstValue(info.key);
    const url = ee || info.url || (key ? `https://dblp.org/rec/${key}` : "");
    const year = firstValue(info.year);
    const id = doi
      ? `doi:${String(doi).toLowerCase()}`
      : key
        ? `dblp:${key}`
        : `dblp:${stableHash(`${title}:${year}:${authors.join(",")}`)}`;

    return {
      id,
      source: "DBLP",
      title,
      authors,
      abstract: "",
      venue: normalizeWhitespace([firstValue(info.venue), year].filter(Boolean).join(" ")),
      published: year ? `${year}-01-01` : "",
      updated: "",
      url,
      pdfUrl: "",
      categories: [firstValue(info.type)].filter(Boolean),
      collectedAt: nowIso(),
      firstSeenAt: nowIso(),
      lastSeenAt: nowIso()
    };
  }).filter((paper) => paper.title);
}

async function enrichPaperWithAi(paper, config) {
  if (cli.noAi) {
    return withFallbackDigest(paper, "命令行启用了 --no-ai");
  }

  if (!config.ai.apiKey) {
    if (config.ai.requireAi) {
      throw new Error("Missing PAPER_AGENT_AI_API_KEY or OPENAI_API_KEY.");
    }
    return withFallbackDigest(paper, "未配置 PAPER_AGENT_AI_API_KEY 或 OPENAI_API_KEY");
  }

  const systemPrompt = [
    `你是 PaperDigestAgent 的 ${HARNESS_VERSION} 论文阅读 harness。`,
    "用户最看重 motivation、method 和 experiments/results，这三项必须具体、可验证、高信息密度。",
    "请只根据用户提供的元数据和摘要写作，不要编造作者单位、实验结果、硬件指标、加速比、数据集、芯片或工艺节点。",
    "如果 DBLP/arXiv 元数据没有提供作者单位，请明确写“未在 DBLP/arXiv 元数据中提供”。",
    "如果实验设置或定量结果没有披露，请明确写“摘要/PDF可读部分未披露”。",
    "输出必须是严格 JSON，不要 Markdown。"
  ].join("");

  const userPrompt = JSON.stringify({
    task: "请按 paper-reader-v1 harness 生成中文论文速递卡片。summaryZh 是辅助字段，motivationZh/methodZh/experimentsZh 是核心字段。",
    userResearchDirection: [
      "AI 处理器芯片和体系结构",
      "大模型量化算法与体系结构",
      "大模型软硬件协同优化",
      "大模型训推系统优化",
      "KV cache/存储层次/近存计算/PIM",
      "AI accelerator/NPU/GPU/TPU/chiplet",
      "agent 软硬件协同优化"
    ],
    requiredSchema: {
      summaryZh: "一段 80 到 140 字的中文摘要",
      motivationZh: "高信息密度动机：具体问题、为什么重要、已有瓶颈、和用户方向的关系",
      methodZh: "高信息密度方法：核心机制、关键组件、算法/系统/体系结构/硬件属性、相对已有方法的新意",
      experimentsZh: "高信息密度实验结果：设置、基线、指标、主要结果；没有证据就写摘要/PDF可读部分未披露",
      affiliationsZh: "作者单位；没有就写未在 DBLP/arXiv 元数据中提供",
      tags: "3 到 6 个中文关键词数组",
      importance: "1 到 5 的整数，越高代表越值得优先阅读",
      researchFitZh: "这篇论文与用户研究方向的关系",
      hardwareRelevance: "1 到 5 的整数",
      algorithmRelevance: "1 到 5 的整数",
      systemRelevance: "1 到 5 的整数",
      readPriority: "deep-read、skim、archive 或 reject",
      whyReadZh: "为什么值得或不值得继续读",
      limitationsZh: "证据缺口、适用边界或未披露内容",
      motivationDetail: {
        problemZh: "具体问题",
        gapZh: "已有方法瓶颈",
        whyImportantZh: "为什么重要",
        userRelevanceZh: "和用户方向的关系",
        evidence: "证据来源"
      },
      methodDetail: {
        coreIdeaZh: "核心想法",
        componentsZh: "关键组件数组",
        hardwareSystemDetailZh: "数据流、存储、调度、量化执行或硬件系统细节；没有就说明未披露",
        noveltyZh: "新意",
        evidence: "证据来源"
      },
      experimentDetail: {
        setupZh: "模型、任务、数据集、硬件平台",
        baselinesZh: "对比基线",
        metricsZh: "指标数组；未披露时写未披露",
        mainResultsZh: "主要结果",
        limitationsZh: "实验边界或未披露项",
        evidence: "证据来源"
      },
      evidence: {
        usedSources: "如 metadata、abstract、pdf:first-2-pages",
        affiliationEvidence: "作者单位证据",
        experimentEvidence: "实验结果证据",
        missingFields: "缺失字段数组"
      },
      confidence: {
        summary: "0 到 1",
        motivation: "0 到 1",
        method: "0 到 1",
        experiments: "0 到 1",
        affiliations: "0 到 1"
      }
    },
    paper: {
      title: paper.title,
      source: paper.source,
      venue: paper.venue,
      published: paper.published,
      authors: paper.authors,
      authorAffiliations: paper.authorAffiliations,
      affiliations: paper.affiliations,
      categories: paper.categories,
      abstract: paper.abstract,
      url: paper.url,
      pdfUrl: paper.pdfUrl,
      localPdfPath: paper.localPdfPath
    }
  });

  try {
    const response = await fetch(config.ai.apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.ai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.ai.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      throw new Error(`AI API ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI API returned no message content.");
    }

    const digest = normalizeAiDigest(parseJsonFromText(content));
    return {
      ...paper,
      digest,
      workflow: {
        ...(paper.workflow ?? {}),
        digestStatus: "ready",
        emailStatus: paper.pushedAt || paper.emailSentAt ? "sent" : "ready",
        harnessVersion: HARNESS_VERSION,
        harnessCheckedAt: nowIso(),
        digestError: ""
      }
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (config.ai.requireAi) {
      throw error;
    }
    console.warn(`AI failed for "${paper.title}": ${reason}`);
    return withFallbackDigest(paper, `AI 调用失败：${reason}`);
  }
}

function withFallbackDigest(paper, reason) {
  const fallbackAffiliations = formatAffiliations(paper) || "未在 DBLP/arXiv 元数据中提供。";
  const sourceNote = paper.abstract
    ? `AI 摘要未生成。原始摘要要点：${truncateCn(paper.abstract, 160)}`
    : "AI 摘要未生成；当前来源元数据未提供摘要。";

  return {
    ...paper,
    workflow: {
      ...(paper.workflow ?? {}),
      digestStatus: reason.includes("AI 调用失败") ? "failed" : "pending",
      emailStatus: "waiting-digest",
      digestError: reason,
      harnessVersion: HARNESS_VERSION
    },
    digest: {
      summaryZh: sourceNote,
      motivationZh: reason,
      methodZh: paper.abstract ? "请配置 AI 后重新运行，以生成方法提炼。" : "来源未提供摘要，无法可靠提炼方法。",
      experimentsZh: "来源元数据未披露完整实验设置或结果。",
      affiliationsZh: fallbackAffiliations,
      tags: paper.categories?.length ? paper.categories.slice(0, 5) : [paper.source],
      importance: 3,
      researchFitZh: "AI harness 尚未完成分析，无法判断与用户研究方向的具体关系。",
      hardwareRelevance: 1,
      algorithmRelevance: 1,
      systemRelevance: 1,
      readPriority: "archive",
      whyReadZh: "需要完成 motivation、method 和实验结果分析后再判断是否值得深读。",
      limitationsZh: reason,
      motivationDetail: {
        problemZh: "harness 未完成分析。",
        gapZh: "harness 未完成分析。",
        whyImportantZh: "harness 未完成分析。",
        userRelevanceZh: "harness 未完成分析。",
        evidence: "not analyzed"
      },
      methodDetail: {
        coreIdeaZh: "harness 未完成分析。",
        componentsZh: ["未分析"],
        hardwareSystemDetailZh: "harness 未完成分析。",
        noveltyZh: "harness 未完成分析。",
        evidence: "not analyzed"
      },
      experimentDetail: {
        setupZh: "harness 未完成分析。",
        baselinesZh: "harness 未完成分析。",
        metricsZh: ["未分析"],
        mainResultsZh: "harness 未完成分析。",
        limitationsZh: "harness 未完成分析。",
        evidence: "not analyzed"
      },
      evidence: {
        usedSources: ["metadata"],
        affiliationEvidence: fallbackAffiliations.includes("未在") ? "" : "metadata",
        experimentEvidence: "",
        missingFields: ["motivation", "method", "experiments"]
      },
      confidence: {
        summary: 0.2,
        motivation: 0,
        method: 0,
        experiments: 0,
        affiliations: fallbackAffiliations.includes("未在") ? 0 : 0.4
      }
    }
  };
}

function normalizeAiDigest(value) {
  return {
    summaryZh: cleanString(value.summaryZh),
    motivationZh: cleanString(value.motivationZh),
    methodZh: cleanString(value.methodZh),
    experimentsZh: cleanString(value.experimentsZh),
    affiliationsZh: cleanString(value.affiliationsZh),
    tags: asArray(value.tags).map(cleanString).filter(Boolean).slice(0, 6),
    importance: clamp(Number.parseInt(value.importance, 10) || 3, 1, 5),
    researchFitZh: cleanString(value.researchFitZh),
    hardwareRelevance: clamp(Number.parseInt(value.hardwareRelevance, 10) || 1, 1, 5),
    algorithmRelevance: clamp(Number.parseInt(value.algorithmRelevance, 10) || 1, 1, 5),
    systemRelevance: clamp(Number.parseInt(value.systemRelevance, 10) || 1, 1, 5),
    readPriority: normalizeReadPriority(value.readPriority),
    whyReadZh: cleanString(value.whyReadZh),
    limitationsZh: cleanString(value.limitationsZh),
    motivationDetail: normalizeMotivationDetail(value.motivationDetail),
    methodDetail: normalizeMethodDetail(value.methodDetail),
    experimentDetail: normalizeExperimentDetail(value.experimentDetail),
    evidence: normalizeEvidence(value.evidence),
    confidence: normalizeConfidence(value.confidence)
  };
}

function normalizeReadPriority(value) {
  return ["deep-read", "skim", "archive", "reject"].includes(value) ? value : "archive";
}

function normalizeMotivationDetail(value = {}) {
  return {
    problemZh: cleanString(value.problemZh),
    gapZh: cleanString(value.gapZh),
    whyImportantZh: cleanString(value.whyImportantZh),
    userRelevanceZh: cleanString(value.userRelevanceZh),
    evidence: cleanString(value.evidence)
  };
}

function normalizeMethodDetail(value = {}) {
  return {
    coreIdeaZh: cleanString(value.coreIdeaZh),
    componentsZh: asArray(value.componentsZh).map(cleanString).filter(Boolean).slice(0, 8),
    hardwareSystemDetailZh: cleanString(value.hardwareSystemDetailZh),
    noveltyZh: cleanString(value.noveltyZh),
    evidence: cleanString(value.evidence)
  };
}

function normalizeExperimentDetail(value = {}) {
  return {
    setupZh: cleanString(value.setupZh),
    baselinesZh: cleanString(value.baselinesZh),
    metricsZh: asArray(value.metricsZh).map(cleanString).filter(Boolean).slice(0, 8),
    mainResultsZh: cleanString(value.mainResultsZh),
    limitationsZh: cleanString(value.limitationsZh),
    evidence: cleanString(value.evidence)
  };
}

function normalizeEvidence(value = {}) {
  return {
    usedSources: asArray(value.usedSources).map(cleanString).filter(Boolean).slice(0, 8),
    affiliationEvidence: cleanString(value.affiliationEvidence),
    experimentEvidence: cleanString(value.experimentEvidence),
    missingFields: asArray(value.missingFields).map(cleanString).filter(Boolean).slice(0, 12)
  };
}

function normalizeConfidence(value = {}) {
  return {
    summary: normalizeConfidenceValue(value.summary),
    motivation: normalizeConfidenceValue(value.motivation),
    method: normalizeConfidenceValue(value.method),
    experiments: normalizeConfidenceValue(value.experiments),
    affiliations: normalizeConfidenceValue(value.affiliations)
  };
}

function normalizeConfidenceValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

function hasUsableDigest(paper) {
  const digest = paper.digest ?? {};
  const text = [
    digest.summaryZh,
    digest.motivationZh,
    digest.methodZh,
    digest.experimentsZh
  ].join(" ");
  return Boolean(digest.summaryZh && !FALLBACK_DIGEST_MARKERS.some((marker) => text.includes(marker)));
}

function isReadyForEmail(paper) {
  return hasUsableDigest(paper) && paper.workflow?.digestStatus === "ready";
}

function markPushedPaper(paper, pushedAt) {
  return {
    ...paper,
    pushedAt,
    emailSentAt: pushedAt,
    firstPushedAt: paper.firstPushedAt ?? paper.pushedAt ?? paper.emailSentAt ?? pushedAt,
    workflow: {
      ...(paper.workflow ?? {}),
      digestStatus: "ready",
      emailStatus: "sent",
      emailSentAt: pushedAt,
      lastEmailError: ""
    }
  };
}

function markEmailFailedPaper(paper, error, failedAt) {
  return {
    ...paper,
    workflow: {
      ...(paper.workflow ?? {}),
      digestStatus: hasUsableDigest(paper) ? "ready" : "pending",
      emailStatus: "failed",
      lastEmailError: formatError(error),
      emailFailedAt: failedAt
    }
  };
}

async function sendDailyDigestEmail(config, dailyDigest, historyDigest) {
  if (!hasEmailConfig(config.email)) {
    console.warn("Email skipped: SMTP settings are incomplete.");
    return;
  }

  const dailyPapers = Array.isArray(dailyDigest.papers) ? dailyDigest.papers : [];
  const unpushedPapers = dailyPapers.filter((paper) => !paper.pushedAt && !paper.emailSentAt);
  const readyPapers = sortPapersForDigest(unpushedPapers.filter(isReadyForEmail));
  const waitingForDigest = unpushedPapers.length - readyPapers.length;

  if (waitingForDigest > 0) {
    console.warn(`Email waiting: ${waitingForDigest} daily papers still need Codex summaries.`);
  }

  if (readyPapers.length === 0 && waitingForDigest > 0) {
    console.log("Email skipped: Codex summaries are not ready yet.");
    return;
  }

  if (readyPapers.length === 0 && !config.email.emailOnEmpty) {
    console.log("Email skipped: no unpushed daily papers with completed summaries.");
    return;
  }

  const subjectDate = String(dailyDigest.digestDate ?? "").trim() || formatDate(new Date());
  const subject = readyPapers.length > 0
    ? `论文日报 ${subjectDate}: ${readyPapers.length} 篇新论文`
    : `论文日报 ${subjectDate}: 今日无新增论文`;
  const html = renderEmailHtml(config, dailyDigest, readyPapers);
  try {
    await sendSmtpMail(config.email, { subject, html });
  } catch (error) {
    const failedAt = nowIso();
    const readyIndex = buildExistingIndex(readyPapers);
    const failedDailyPapers = dailyPapers.map((paper) => findExistingPaper(paper, readyIndex) ? markEmailFailedPaper(paper, error, failedAt) : paper);
    const failedDailyDigest = buildDailyDigest(config, failedDailyPapers, dailyDigest.digestDate ?? localDateKey(), {
      collected: dailyDigest.stats?.collected ?? 0,
      dailyCount: dailyDigest.stats?.dailyCandidates ?? 0,
      conferenceCount: dailyDigest.stats?.conferenceCandidates ?? 0,
      backfillCount: dailyDigest.stats?.backfillCandidates ?? 0,
      rawCandidates: dailyDigest.stats?.rawCandidates ?? dailyDigest.stats?.collected ?? 0,
      newlyAdded: dailyDigest.stats?.newlyAdded ?? 0
    });
    await writeDigest(config.dailyOutputPath, failedDailyDigest);
    throw new Error(`Email failed: ${formatError(error)}`);
  }
  console.log(`Email sent to ${config.email.to.join(", ")}.`);

  if (readyPapers.length === 0) {
    return;
  }

  const pushedAt = nowIso();
  const pushedPapers = readyPapers.map((paper) => markPushedPaper(paper, pushedAt));
  const pushedIndex = buildExistingIndex(pushedPapers);
  const updatedDailyPapers = dailyPapers.map((paper) => {
    const pushedPaper = findExistingPaper(paper, pushedIndex);
    return pushedPaper ? pushedPaper : paper;
  });
  const updatedDailyDigest = buildDailyDigest(config, updatedDailyPapers, dailyDigest.digestDate ?? localDateKey(), {
    collected: dailyDigest.stats?.collected ?? 0,
    dailyCount: dailyDigest.stats?.dailyCandidates ?? 0,
    conferenceCount: dailyDigest.stats?.conferenceCandidates ?? 0,
    backfillCount: dailyDigest.stats?.backfillCandidates ?? 0,
    rawCandidates: dailyDigest.stats?.rawCandidates ?? dailyDigest.stats?.collected ?? 0,
    newlyAdded: dailyDigest.stats?.newlyAdded ?? 0
  });
  const historyPapers = Array.isArray(historyDigest.papers) ? historyDigest.papers : [];
  const updatedHistoryDigest = buildHistoryDigest(config, historyDigest, [...pushedPapers, ...historyPapers]);

  await writeDigest(config.dailyOutputPath, updatedDailyDigest);
  await writeDigest(config.outputPath, updatedHistoryDigest);
  console.log(`Marked ${pushedPapers.length} papers as pushed and updated history library.`);
}

function renderEmailHtml(config, digest, newPapers) {
  const papers = newPapers;
  const paperHtml = papers.map((paper) => `
    <article style="border:1px solid #d8e1ef;border-radius:10px;padding:16px;margin:0 0 14px;background:#ffffff;">
      <p style="margin:0 0 6px;color:#65758d;font-size:13px;">${escapeHtml(paper.source)} · ${escapeHtml(displayDate(paper.published))} · ${escapeHtml(paper.recommendationLabel ?? "")} · 重要度 ${paper.digest?.importance ?? 3}/5</p>
      <h2 style="font-size:18px;line-height:1.35;margin:0 0 10px;color:#102d59;">${escapeHtml(paper.title)}</h2>
      <p style="margin:0 0 10px;color:#23364f;line-height:1.7;">${escapeHtml(paper.digest?.summaryZh ?? "")}</p>
      ${emailField("Motivation", paper.digest?.motivationZh)}
      ${emailField("Method", paper.digest?.methodZh)}
      ${emailField("实验结果", paper.digest?.experimentsZh)}
      ${emailField("作者单位", paper.digest?.affiliationsZh)}
      ${emailField("为什么值得读", paper.digest?.whyReadZh)}
      ${emailField("相关度", renderRelevanceText(paper.digest))}
      <p style="margin:12px 0 0;"><a href="${escapeAttribute(paper.url)}" style="color:#0c58a8;">打开论文</a>${paper.pdfUrl ? ` · <a href="${escapeAttribute(paper.pdfUrl)}" style="color:#0c58a8;">PDF</a>` : ""}${paper.localPdfUrl ? ` · <a href="${escapeAttribute(config.siteUrl.replace(/\/$/, "") + paper.localPdfUrl)}" style="color:#0c58a8;">本地 PDF</a>` : ""}</p>
    </article>
  `).join("");

  return `
    <!doctype html>
    <html lang="zh-CN">
      <body style="margin:0;background:#f4f7fb;color:#15243a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
        <main style="max-width:760px;margin:0 auto;padding:24px;">
          <h1 style="font-size:24px;line-height:1.3;margin:0 0 8px;color:#102d59;">每日论文速递</h1>
          <p style="margin:0 0 18px;color:#65758d;">生成时间：${escapeHtml(displayDateTime(digest.generatedAt))} · 新增 ${newPapers.length} 篇</p>
          ${paperHtml || `<p style="background:#fff;border-radius:10px;padding:16px;">今天没有新增论文。</p>`}
          <p style="margin:18px 0 0;"><a href="${escapeAttribute(config.siteUrl)}" style="color:#0c58a8;font-weight:700;">打开本地阅读站</a></p>
        </main>
      </body>
    </html>
  `;
}

function emailField(label, value) {
  if (!value) {
    return "";
  }
  return `<p style="margin:8px 0 0;color:#23364f;line-height:1.7;"><strong>${escapeHtml(label)}：</strong>${escapeHtml(value)}</p>`;
}

function renderRelevanceText(digest = {}) {
  const parts = [
    digest.readPriority ? `阅读优先级 ${digest.readPriority}` : "",
    digest.hardwareRelevance ? `硬件 ${digest.hardwareRelevance}/5` : "",
    digest.systemRelevance ? `系统 ${digest.systemRelevance}/5` : "",
    digest.algorithmRelevance ? `算法 ${digest.algorithmRelevance}/5` : ""
  ].filter(Boolean);
  return parts.join(" · ");
}

async function sendSmtpMail(email, message) {
  const port = email.port || (email.secure ? 465 : 587);
  let socket = email.secure
    ? tls.connect({ host: email.host, port, servername: email.host })
    : net.connect({ host: email.host, port });
  let reader = createSmtpReader(socket);

  await reader.expect([220]);
  await smtpCommand(socket, reader, `EHLO ${smtpLocalName()}`, [250]);

  if (!email.secure && email.starttls) {
    await smtpCommand(socket, reader, "STARTTLS", [220]);
    socket = tls.connect({ socket, servername: email.host });
    reader = createSmtpReader(socket);
    await smtpCommand(socket, reader, `EHLO ${smtpLocalName()}`, [250]);
  }

  if (email.user || email.pass) {
    await smtpCommand(socket, reader, "AUTH LOGIN", [334]);
    await smtpCommand(socket, reader, Buffer.from(email.user).toString("base64"), [334]);
    await smtpCommand(socket, reader, Buffer.from(email.pass).toString("base64"), [235]);
  }

  const fromAddress = extractEmailAddress(email.from);
  await smtpCommand(socket, reader, `MAIL FROM:<${fromAddress}>`, [250]);
  for (const recipient of email.to) {
    await smtpCommand(socket, reader, `RCPT TO:<${extractEmailAddress(recipient)}>`, [250, 251]);
  }
  await smtpCommand(socket, reader, "DATA", [354]);
  socket.write(formatMimeMessage(email, message));
  await reader.expect([250]);
  await smtpCommand(socket, reader, "QUIT", [221]);
  socket.end();
}

function formatMimeMessage(email, message) {
  const headers = [
    `From: ${email.from}`,
    `To: ${email.to.join(", ")}`,
    `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit"
  ];
  const body = message.html.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
  return `${headers.join("\r\n")}\r\n\r\n${body}\r\n.\r\n`;
}

function createSmtpReader(socket) {
  let buffer = "";
  const waiters = [];
  let rejected = false;

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    flush();
  });
  socket.on("error", (error) => {
    rejected = true;
    while (waiters.length) {
      waiters.shift().reject(error);
    }
  });

  function flush() {
    if (rejected) {
      return;
    }

    const complete = takeCompleteSmtpResponse(buffer);
    if (!complete || waiters.length === 0) {
      return;
    }

    buffer = complete.rest;
    waiters.shift().resolve(complete.text);
  }

  return {
    read() {
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
        flush();
      });
    },
    async expect(codes) {
      const text = await this.read();
      const code = Number.parseInt(text.slice(0, 3), 10);
      if (!codes.includes(code)) {
        throw new Error(`SMTP expected ${codes.join("/")} but received: ${text}`);
      }
      return text;
    }
  };
}

async function smtpCommand(socket, reader, command, expectedCodes) {
  socket.write(`${command}\r\n`);
  return reader.expect(expectedCodes);
}

function takeCompleteSmtpResponse(buffer) {
  const lines = buffer.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\d{3} /.test(lines[index])) {
      return {
        text: lines.slice(0, index + 1).join("\n"),
        rest: lines.slice(index + 1).join("\n")
      };
    }
  }
  return null;
}

async function fetchText(url) {
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": "SteelWebPaperAgent/1.0 (research digest; contact configured by user)"
    }
  });
  return response.text();
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "SteelWebPaperAgent/1.0 (research digest; contact configured by user)"
    }
  });
  return response.json();
}

async function fetchWithRetry(url, options, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
        const error = new Error(`${response.status} ${response.statusText}`);
        error.status = response.status;
        error.retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 0;
        throw error;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(getRetryDelayMs(error, attempt));
      }
    }
  }
  throw new Error(`Fetch failed for ${url}: ${lastError instanceof Error ? lastError.message : lastError}`);
}

function getRetryDelayMs(error, attempt) {
  if (error?.retryAfterMs) {
    return error.retryAfterMs;
  }

  if (error?.status === 429 || error?.status === 503) {
    return 3500 * (attempt + 1);
  }

  return 900 * (attempt + 1);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(args) {
  const parsed = {
    sendEmail: false,
    noEmail: false,
    noAi: false,
    emailOnly: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => args[++index];

    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--config":
        parsed.configPath = next();
        break;
      case "--send-email":
        parsed.sendEmail = true;
        break;
      case "--email-only":
      case "--no-collect":
        parsed.emailOnly = true;
        break;
      case "--no-email":
        parsed.noEmail = true;
        break;
      case "--no-ai":
        parsed.noAi = true;
        break;
      case "--download-pdfs":
        parsed.pdf = { ...(parsed.pdf ?? {}), enabled: true };
        break;
      case "--no-pdf":
        parsed.pdf = { ...(parsed.pdf ?? {}), enabled: false };
        break;
      case "--pdf-dir":
        parsed.pdf = { ...(parsed.pdf ?? {}), directory: next() };
        break;
      case "--pdf-max":
        parsed.pdf = { ...(parsed.pdf ?? {}), maxPerRun: Number.parseInt(next(), 10) };
        break;
      case "--mode":
        parsed.collectionMode = next();
        break;
      case "--days":
        parsed.daysBack = Number.parseInt(next(), 10);
        break;
      case "--max":
        parsed.maxPapers = Number.parseInt(next(), 10);
        break;
      case "--max-per-query":
        parsed.maxPerQuery = Number.parseInt(next(), 10);
        break;
      case "--output":
        parsed.outputPath = next();
        break;
      case "--daily-output":
        parsed.dailyOutputPath = next();
        break;
      case "--digest-date":
        parsed.digestDate = next();
        break;
      case "--arxiv-query":
        parsed.arxivQueries = [...(parsed.arxivQueries ?? []), next()];
        break;
      case "--dblp-query":
        parsed.dblpQueries = [...(parsed.dblpQueries ?? []), next()];
        break;
      case "--theme":
        parsed.targetThemes = [...(parsed.targetThemes ?? []), next()];
        break;
      case "--venue":
        parsed.conferenceVenues = [...(parsed.conferenceVenues ?? []), next()];
        break;
      case "--year":
        parsed.conferenceYears = [...(parsed.conferenceYears ?? []), next()];
        break;
      case "--daily-max":
        parsed.dailyMaxPapers = Number.parseInt(next(), 10);
        break;
      case "--daily-primary-max":
        parsed.dailyPrimaryMaxPapers = Number.parseInt(next(), 10);
        break;
      case "--daily-trend-max":
        parsed.dailyTrendMaxPapers = Number.parseInt(next(), 10);
        break;
      case "--min-new":
        parsed.minNewPapers = Number.parseInt(next(), 10);
        break;
      case "--no-backfill":
        parsed.backfillEnabled = false;
        break;
      case "--backfill-days":
        parsed.backfillDays = Number.parseInt(next(), 10);
        break;
      case "--backfill-max-per-query":
        parsed.backfillMaxPerQuery = Number.parseInt(next(), 10);
        break;
      case "--conference-max":
        parsed.conferenceMaxPapers = Number.parseInt(next(), 10);
        break;
      case "--conference-max-per-query":
        parsed.conferenceMaxPerQuery = Number.parseInt(next(), 10);
        break;
      case "--conference-max-queries":
        parsed.conferenceMaxQueries = Number.parseInt(next(), 10);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  npm run papers:daily
  node scripts/paper-agent.mjs --email-only --send-email
  node scripts/paper-agent.mjs --no-ai --no-email --max 5

Options:
  --config <path>        Read optional JSON config.
  --mode <mode>          Collection mode: all, daily, or conference.
  --arxiv-query <query>  Add an arXiv query. Can be repeated.
  --dblp-query <query>   Add a DBLP query. Can be repeated.
  --theme <theme>        Target theme for conference archive search. Can be repeated.
  --venue <venue>        Conference venue, e.g. NeurIPS, ICML, CVPR. Can be repeated.
  --year <year|a-b>      Conference year or range. Can be repeated.
  --days <n>             Keep arXiv submissions from the last n days.
  --max <n>              Max current papers to show and email.
  --max-per-query <n>    Max results per source query.
  --daily-max <n>        Max daily-latest papers to keep in this run.
  --daily-primary-max <n> Max hardware/architecture-track daily papers.
  --daily-trend-max <n>  Max algorithm-trend daily papers.
  --min-new <n>          Target minimum unpushed papers; backfill tries to reach this.
  --no-backfill          Disable expanded daily backfill discovery.
  --backfill-days <n>    Backfill arXiv lookback window.
  --backfill-max-per-query <n> Max results per query during backfill.
  --conference-max <n>   Max conference-archive papers to keep in this run.
  --output <path>        Output digest JSON path.
  --daily-output <path>  Daily new-paper JSON path.
  --digest-date <date>   Digest date to process, useful for backfilling old daily JSON.
  --download-pdfs        Cache arXiv PDFs locally when pdfUrl is available.
  --no-pdf               Do not download PDFs for this run.
  --pdf-dir <path>       Local PDF cache directory.
  --pdf-max <n>          Max PDFs to download in one run.
  --email-only           Do not collect; send unpushed papers from daily JSON.
  --send-email           Send digest email through SMTP.
  --no-email             Never send email for this run.
  --no-ai                Skip AI calls and write fallback summaries.
`);
}

function normalizeConfig(config) {
  const collectionMode = ["all", "daily", "conference"].includes(config.collectionMode) ? config.collectionMode : "all";

  return {
    ...config,
    collectionMode,
    daysBack: positiveInt(config.daysBack, 7),
    maxPerQuery: positiveInt(config.maxPerQuery, 8),
    maxPapers: positiveInt(config.maxPapers, 12),
    dailyMaxPapers: positiveInt(config.dailyMaxPapers, positiveInt(config.maxPapers, 12)),
    dailyPrimaryMaxPapers: positiveInt(config.dailyPrimaryMaxPapers, 6),
    dailyTrendMaxPapers: positiveInt(config.dailyTrendMaxPapers, 2),
    minNewPapers: positiveInt(config.minNewPapers, 5),
    backfillEnabled: Boolean(config.backfillEnabled),
    backfillDays: positiveInt(config.backfillDays, 45),
    backfillMaxPerQuery: positiveInt(config.backfillMaxPerQuery, 24),
    conferenceMaxPapers: positiveInt(config.conferenceMaxPapers, 12),
    conferenceMaxPerQuery: positiveInt(config.conferenceMaxPerQuery, 3),
    conferenceMaxQueries: positiveInt(config.conferenceMaxQueries, 40),
    archiveLimit: positiveInt(config.archiveLimit, 240),
    arxivQueries: cleanList(config.arxivQueries),
    dblpQueries: cleanList(config.dblpQueries),
    targetThemes: cleanList(config.targetThemes),
    conferenceVenues: cleanList(config.conferenceVenues),
    conferenceYears: parseYears(asArray(config.conferenceYears).join(";")),
    outputPath: config.outputPath || "public/research-digest/papers.json",
    dailyOutputPath: config.dailyOutputPath || "public/research-digest/daily.json",
    pdf: {
      ...config.pdf,
      enabled: Boolean(config.pdf?.enabled),
      directory: config.pdf?.directory || "public/research-digest/pdfs",
      maxPerRun: positiveInt(config.pdf?.maxPerRun, 12)
    },
    ai: {
      ...config.ai,
      apiUrl: normalizeAiApiUrl(config.ai?.apiUrl),
      model: config.ai?.model || "gpt-4o-mini",
      apiKey: config.ai?.apiKey || ""
    },
    email: {
      ...config.email,
      to: cleanList(config.email?.to ?? []),
      port: Number(config.email?.port) || (config.email?.secure ? 465 : 587)
    }
  };
}

function mergeConfig(...configs) {
  return configs.reduce((merged, current) => deepMerge(merged, current ?? {}), {});
}

function deepMerge(target, source) {
  const output = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null || key === "help") {
      continue;
    }
    if (Array.isArray(value)) {
      output[key] = value;
    } else if (typeof value === "object" && !Array.isArray(value) && typeof output[key] === "object") {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function getDailyPapersForDate(digest, digestDate) {
  if (digest?.digestDate && digest.digestDate !== digestDate) {
    return [];
  }
  return Array.isArray(digest?.papers) ? digest.papers : [];
}

function buildDailyDigest(config, papers, digestDate, runStats = {}) {
  const dailyPapers = sortPapersForDigest(dedupePapers(papers).map(normalizePaperWorkflow));
  return {
    generatedAt: nowIso(),
    digestDate,
    kind: "daily-new",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    siteUrl: config.siteUrl,
    historyPath: config.outputPath,
    sources: buildSources(config),
    stats: {
      ...buildPaperStats(dailyPapers),
      current: dailyPapers.length,
      collected: runStats.collected ?? 0,
      dailyCandidates: runStats.dailyCount ?? 0,
      conferenceCandidates: runStats.conferenceCount ?? 0,
      backfillCandidates: runStats.backfillCount ?? 0,
      rawCandidates: runStats.rawCandidates ?? runStats.collected ?? 0,
      newlyAdded: runStats.newlyAdded ?? 0,
      pendingDigest: dailyPapers.filter((paper) => !hasUsableDigest(paper)).length,
      pendingEmail: dailyPapers.filter((paper) => !paper.pushedAt && !paper.emailSentAt && isReadyForEmail(paper)).length,
      pushed: dailyPapers.filter((paper) => paper.pushedAt || paper.emailSentAt).length,
      failedDigest: dailyPapers.filter((paper) => paper.workflow?.digestStatus === "failed").length,
      failedEmail: dailyPapers.filter((paper) => paper.workflow?.emailStatus === "failed").length,
      pdfDownloaded: dailyPapers.filter((paper) => paper.pdfStatus === "downloaded").length,
      pdfFailed: dailyPapers.filter((paper) => paper.pdfStatus === "failed").length,
      hardwarePrimary: dailyPapers.filter((paper) => paper.recommendationTrack === "hardware-primary").length,
      algorithmTrend: dailyPapers.filter((paper) => paper.recommendationTrack === "algorithm-trend").length,
      lowRelevance: dailyPapers.filter((paper) => paper.recommendationTrack === "off-topic").length
    },
    papers: dailyPapers
  };
}

function buildHistoryDigest(config, previousDigest, papers) {
  const archivedPapers = sortPapersForDigest(dedupePapers(papers).map(normalizePaperWorkflow)).slice(0, config.archiveLimit);
  return {
    ...previousDigest,
    generatedAt: nowIso(),
    kind: "history",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    siteUrl: config.siteUrl,
    dailyPath: config.dailyOutputPath,
    sources: buildSources(config),
    stats: {
      ...buildPaperStats(archivedPapers),
      current: 0,
      newlyAdded: 0,
      pushed: archivedPapers.filter((paper) => paper.pushedAt || paper.emailSentAt).length,
      pdfDownloaded: archivedPapers.filter((paper) => paper.pdfStatus === "downloaded").length,
      hardwarePrimary: archivedPapers.filter((paper) => paper.recommendationTrack === "hardware-primary").length,
      algorithmTrend: archivedPapers.filter((paper) => paper.recommendationTrack === "algorithm-trend").length,
      lowRelevance: archivedPapers.filter((paper) => paper.recommendationTrack === "off-topic").length
    },
    papers: archivedPapers
  };
}

function buildSources(config) {
  return {
    collectionMode: config.collectionMode,
    arxivQueries: config.arxivQueries,
    dblpQueries: config.dblpQueries,
    targetThemes: config.targetThemes,
    conferenceVenues: config.conferenceVenues,
    conferenceYears: config.conferenceYears,
    daysBack: config.daysBack,
    maxPapers: config.maxPapers,
    dailyMaxPapers: config.dailyMaxPapers,
    dailyPrimaryMaxPapers: config.dailyPrimaryMaxPapers,
    dailyTrendMaxPapers: config.dailyTrendMaxPapers,
    minNewPapers: config.minNewPapers,
    backfillEnabled: config.backfillEnabled,
    backfillDays: config.backfillDays,
    backfillMaxPerQuery: config.backfillMaxPerQuery,
    conferenceMaxPapers: config.conferenceMaxPapers,
    pdfDownloadEnabled: config.pdf.enabled,
    pdfDirectory: config.pdf.directory,
    pdfMaxPerRun: config.pdf.maxPerRun
  };
}

function buildPaperStats(papers) {
  return {
    total: papers.length,
    arxiv: papers.filter((paper) => paper.source === "arXiv").length,
    dblp: papers.filter((paper) => paper.source === "DBLP").length,
    dailyLatest: papers.filter((paper) => paper.collectionTypes?.includes("daily-latest") || paper.collectionType === "daily-latest").length,
    dailyBackfill: papers.filter((paper) => paper.collectionTypes?.includes("daily-backfill") || paper.collectionType === "daily-backfill").length,
    conferenceArchive: papers.filter((paper) => paper.collectionTypes?.includes("conference-archive") || paper.collectionType === "conference-archive").length
  };
}

async function readDigest(outputPath) {
  return (await readJsonIfExists(resolveFromRoot(outputPath))) ?? { papers: [] };
}

async function writeDigest(outputPath, digest) {
  const fullPath = resolveFromRoot(outputPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(digest, null, 2)}\n`, "utf8");
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function loadEnvFile(filePath) {
  let content;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function buildExistingIndex(papers) {
  return {
    byId: new Map(papers.map((paper) => [paper.id, paper])),
    byTitle: new Map(papers.map((paper) => [titleKey(paper.title), paper]))
  };
}

function findExistingPaper(paper, index) {
  return index.byId.get(paper.id) ?? index.byTitle.get(titleKey(paper.title));
}

function mergeExistingPaper(existing, paper) {
  return {
    ...existing,
    ...paper,
    digest: existing.digest ?? paper.digest,
    collectionTypes: uniqueList([...(existing.collectionTypes ?? [existing.collectionType]), ...(paper.collectionTypes ?? [paper.collectionType])]),
    matchedQueries: uniqueList([...(existing.matchedQueries ?? [existing.matchedQuery]), ...(paper.matchedQueries ?? [paper.matchedQuery])]),
    targetThemes: uniqueList([...(existing.targetThemes ?? [existing.targetTheme]), ...(paper.targetThemes ?? [paper.targetTheme])]),
    conferenceVenues: uniqueList([...(existing.conferenceVenues ?? [existing.conferenceVenue]), ...(paper.conferenceVenues ?? [paper.conferenceVenue])]),
    conferenceYears: uniqueList([...(existing.conferenceYears ?? [existing.conferenceYear]), ...(paper.conferenceYears ?? [paper.conferenceYear])]),
    affiliations: uniqueList([...(existing.affiliations ?? []), ...(paper.affiliations ?? [])]),
    firstSeenAt: existing.firstSeenAt ?? existing.collectedAt ?? nowIso(),
    lastSeenAt: nowIso()
  };
}

function tagPaper(paper, metadata) {
  return {
    ...paper,
    ...metadata,
    collectionTypes: uniqueList([...(paper.collectionTypes ?? [paper.collectionType]), metadata.collectionType]),
    matchedQueries: uniqueList([...(paper.matchedQueries ?? [paper.matchedQuery]), metadata.matchedQuery]),
    targetThemes: uniqueList([...(paper.targetThemes ?? [paper.targetTheme]), metadata.targetTheme]),
    conferenceVenues: uniqueList([...(paper.conferenceVenues ?? [paper.conferenceVenue]), metadata.conferenceVenue]),
    conferenceYears: uniqueList([...(paper.conferenceYears ?? [paper.conferenceYear]), metadata.conferenceYear])
  };
}

function dedupePapers(papers) {
  const map = new Map();
  for (const paper of papers) {
    const key = paper.id || titleKey(paper.title);
    const title = titleKey(paper.title);
    if (!key || !title) {
      continue;
    }
    const existing = map.get(key) ?? [...map.values()].find((item) => titleKey(item.title) === title);
    if (!existing) {
      map.set(key, paper);
      continue;
    }
    map.set(existing.id || key, preferRicherPaper(existing, paper));
  }
  return [...map.values()];
}

function preferRicherPaper(a, b) {
  const aScore = richnessScore(a);
  const bScore = richnessScore(b);
  const preferred = bScore > aScore ? { ...a, ...b, digest: b.digest ?? a.digest } : { ...b, ...a, digest: a.digest ?? b.digest };
  return {
    ...preferred,
    collectionTypes: uniqueList([...(a.collectionTypes ?? [a.collectionType]), ...(b.collectionTypes ?? [b.collectionType])]),
    matchedQueries: uniqueList([...(a.matchedQueries ?? [a.matchedQuery]), ...(b.matchedQueries ?? [b.matchedQuery])]),
    targetThemes: uniqueList([...(a.targetThemes ?? [a.targetTheme]), ...(b.targetThemes ?? [b.targetTheme])]),
    conferenceVenues: uniqueList([...(a.conferenceVenues ?? [a.conferenceVenue]), ...(b.conferenceVenues ?? [b.conferenceVenue])]),
    conferenceYears: uniqueList([...(a.conferenceYears ?? [a.conferenceYear]), ...(b.conferenceYears ?? [b.conferenceYear])]),
    affiliations: uniqueList([...(a.affiliations ?? []), ...(b.affiliations ?? [])])
  };
}

function richnessScore(paper) {
  return [
    paper.abstract?.length ?? 0,
    paper.localPdfPath ? 80 : paper.pdfUrl ? 50 : 0,
    paper.affiliations?.length ? 60 : 0,
    paper.authors?.length ?? 0,
    paper.digest ? 100 : 0
  ].reduce((sum, value) => sum + value, 0);
}

function sortPapersByDate(papers) {
  return [...papers].sort((a, b) => paperTime(b) - paperTime(a));
}

function paperTime(paper) {
  const value = Date.parse(paper.published || paper.updated || paper.collectedAt || "");
  return Number.isNaN(value) ? 0 : value;
}

function parseJsonFromText(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("AI response was not valid JSON.");
  }
}

function parseXmlAttributes(input) {
  const attrs = {};
  for (const match of input.matchAll(/([:\w-]+)=["']([^"']*)["']/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function normalizePaperWorkflow(paper) {
  const pushed = Boolean(paper.pushedAt || paper.emailSentAt);
  const digestReady = hasUsableDigest(paper);
  const digestStatus = paper.workflow?.digestStatus === "failed"
    ? "failed"
    : digestReady ? "ready" : paper.workflow?.digestStatus ?? "pending";
  const workflow = {
    ...(paper.workflow ?? {}),
    collectStatus: paper.workflow?.collectStatus ?? "collected",
    digestStatus,
    emailStatus: pushed ? "sent" : digestStatus === "ready" ? paper.workflow?.emailStatus === "failed" ? "failed" : "ready" : "waiting-digest",
    pdfStatus: paper.pdfStatus ?? paper.workflow?.pdfStatus ?? (paper.pdfUrl ? "remote" : "none")
  };

  if (paper.pdfError) {
    workflow.pdfError = paper.pdfError;
  }

  return {
    ...normalizePdfMetadata(paper),
    workflow
  };
}

function normalizePdfMetadata(paper) {
  return {
    ...paper,
    pdfStatus: paper.pdfStatus ?? (paper.localPdfPath ? "downloaded" : paper.pdfUrl ? "remote" : "none")
  };
}

function formatAffiliations(paper) {
  const direct = uniqueList(paper.affiliations ?? []);
  if (direct.length) {
    return direct.join("；");
  }

  const authorAffiliations = asArray(paper.authorAffiliations)
    .map((item) => normalizeWhitespace(item?.affiliation ?? ""))
    .filter(Boolean);
  return uniqueList(authorAffiliations).join("；");
}

function pdfFileNameForPaper(paper) {
  const base = String(paper.id || stableHash(`${paper.title}:${paper.published}`))
    .replace(/^arxiv:/, "arxiv-")
    .replace(/^doi:/, "doi-")
    .replace(/^dblp:/, "dblp-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(0, 96);
  return `${base || stableHash(paper.title)}.pdf`;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeRelativePath(value) {
  return String(value).replace(/\\/g, "/").replace(/^\.?\//, "");
}

function publicUrlForRelativePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  return normalized.startsWith("public/") ? `/${normalized.slice("public/".length)}` : "";
}

function textFromXml(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(stripTags(match[1])) : "";
}

function stripTags(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ");
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeDblpAuthors(authorValue) {
  return asArray(authorValue).map((author) => {
    if (typeof author === "string") {
      return normalizeWhitespace(author);
    }
    return normalizeWhitespace(author?.text ?? author?._ ?? author?.name ?? "");
  }).filter(Boolean);
}

function asArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function firstValue(value) {
  const first = asArray(value)[0];
  if (first && typeof first === "object") {
    return first.text ?? first._ ?? first.name ?? "";
  }
  return first ?? "";
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanString(value) {
  return normalizeWhitespace(value).slice(0, 1200);
}

function cleanList(value) {
  return asArray(value).flatMap((item) => String(item).split(/\n|;/)).map((item) => item.trim()).filter(Boolean);
}

function uniqueList(value) {
  return Array.from(new Set(asArray(value).flat().filter((item) => item !== undefined && item !== null && String(item).trim()).map((item) => String(item).trim())));
}

function listFromEnv(name) {
  const value = process.env[name];
  return value ? cleanList(value) : undefined;
}

function yearsFromEnv(name) {
  const value = process.env[name];
  return value ? parseYears(value) : undefined;
}

function parseYears(value) {
  const years = [];
  for (const part of String(value).split(/[;,\n]/).map((item) => item.trim()).filter(Boolean)) {
    const range = part.match(/^(\d{4})\s*-\s*(\d{4})$/);
    if (range) {
      const start = Number.parseInt(range[1], 10);
      const end = Number.parseInt(range[2], 10);
      const step = start <= end ? 1 : -1;
      for (let year = start; step > 0 ? year <= end : year >= end; year += step) {
        years.push(String(year));
      }
      continue;
    }

    if (/^\d{4}$/.test(part)) {
      years.push(part);
    }
  }

  return uniqueList(years);
}

function defaultConferenceYears() {
  const currentYear = new Date().getFullYear();
  return [currentYear - 1, currentYear - 2, currentYear - 3].map(String);
}

function isDailyMode(config) {
  return config.collectionMode === "all" || config.collectionMode === "daily";
}

function isConferenceMode(config) {
  return config.collectionMode === "all" || config.collectionMode === "conference";
}

function boolFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  return /^(1|true|yes|on)$/i.test(value);
}

function numberFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function truncateCn(value, limit) {
  const text = normalizeWhitespace(value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function titleKey(title) {
  return normalizeWhitespace(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stableHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function nowIso() {
  return new Date().toISOString();
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function displayDate(value) {
  if (!value) {
    return "日期未知";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().slice(0, 10);
}

function displayDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function resolveFromRoot(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function normalizeAiApiUrl(value) {
  if (!value) {
    return "https://api.openai.com/v1/chat/completions";
  }
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function defaultSiteUrl() {
  const basePath = normalizeBasePath(process.env.SITE_BASE_PATH ?? "");
  return `http://localhost:4173${basePath}/`;
}

function normalizeBasePath(value) {
  if (!value || value === "/") {
    return "";
  }
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function hasEmailConfig(email) {
  return Boolean(email.host && email.from && email.to.length > 0);
}

function extractEmailAddress(value) {
  const match = String(value).match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
}

function smtpLocalName() {
  return process.env.PAPER_AGENT_SMTP_HELO ?? "localhost";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
