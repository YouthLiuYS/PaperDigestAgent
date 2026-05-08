import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HARNESS_VERSION = "paper-reader-v1";

export const FALLBACK_DIGEST_MARKERS = [
  "AI 摘要未生成",
  "命令行启用了 --no-ai",
  "AI 调用失败",
  "未配置 PAPER_AGENT_AI_API_KEY"
];

export const READ_PRIORITIES = ["deep-read", "skim", "archive", "reject"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..");

const GENERIC_PATTERNS = [
  "提出了一种方法",
  "提出一种方法",
  "提出了一个框架",
  "提出一个框架",
  "提升性能",
  "提高效率",
  "效果显著",
  "实验表明",
  "具有重要意义"
];

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(resolveFromRoot(filePath), "utf8"));
}

export async function writeJson(filePath, value) {
  const fullPath = resolveFromRoot(filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function resolveFromRoot(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

export function isUnpushedPaper(paper) {
  return !paper.pushedAt && !paper.emailSentAt;
}

export function hasUsableDigest(paper) {
  const digest = paper.digest ?? {};
  const text = [
    digest.summaryZh,
    digest.motivationZh,
    digest.methodZh,
    digest.experimentsZh
  ].join(" ");
  return Boolean(digest.summaryZh && !FALLBACK_DIGEST_MARKERS.some((marker) => text.includes(marker)));
}

export function needsHarnessDigest(paper) {
  return isUnpushedPaper(paper)
    && (!hasUsableDigest(paper)
      || paper.workflow?.digestStatus === "pending"
      || paper.workflow?.digestStatus === "failed"
      || paper.workflow?.harnessVersion !== HARNESS_VERSION);
}

export function buildHarnessPrompt(papers, options = {}) {
  const compactPapers = papers.map(compactPaperForHarness);
  const projectPath = options.projectPath ?? repoRoot;
  const dailyPath = options.dailyPath ?? "public/research-digest/daily.json";
  const outputMode = options.outputMode ?? "json";
  const fileInstruction = outputMode === "file"
    ? [
      `Read and update only ${dailyPath}. Do not edit public/research-digest/papers.json.`,
      "Apply the generated digest objects directly to the matching papers in daily.json.",
      "After editing, return a short plain-text report with processed/failed counts."
    ]
    : [
      "Do not edit files. Return only the JSON object described below.",
      `Use ${dailyPath} only as context for matching paper ids.`
    ];

  return [
    `You are the ${HARNESS_VERSION} reading harness for PaperDigestAgent.`,
    "",
    `Work only inside ${projectPath}.`,
    ...fileInstruction,
    "Process only the paper ids provided below.",
    "",
    "User research direction:",
    "- Primary: AI processor chips and computer architecture, LLM accelerator architecture, NPU/GPU/TPU, PNM/processing-near-memory and near-data/memory-side computing, chiplet/3D memory, KV cache and memory hierarchy, LLM training/inference systems, software-hardware co-design, hardware-friendly quantization, agent hardware-software co-design.",
    "- Treat PIM/processing-in-memory as secondary context only. Do not over-prioritize PIM-only papers unless they clearly inform PNM, memory hierarchy, AI processor architecture, or LLM accelerator design.",
    "- Secondary: algorithm-level LLM/agent/multimodal/post-training trends, only for awareness and never at the expense of hardware/system papers.",
    "",
    "Reading protocol:",
    "1. L0 Metadata Pass: read title, authors, venue, categories, recommendationTrack, relevanceReason, abstract, affiliations, authorAffiliations.",
    "2. L1 First Pages Pass: if localPdfPath exists and is readable, inspect only the first two PDF pages first. Use them to improve affiliations and the true problem statement. If PDF is unavailable, do not guess.",
    "3. L2 Evidence Pass: only for hardware-primary, system-relevant, or importance >= 4 papers. Inspect method/design/evaluation sections when available. Extract concrete evidence for method and experimental results.",
    "",
    "Hard priorities:",
    "1. motivationZh must clearly answer: what problem, why important, what existing gap/bottleneck, and why it matters to the user's direction.",
    "2. methodZh must clearly answer: core idea, whether it is algorithm/system/architecture/compiler/hardware/co-design, key components, and novelty.",
    "3. experimentsZh must clearly answer: setup, baselines, metrics, main quantitative or qualitative results, and missing evidence if not disclosed.",
    "4. summaryZh is secondary. Do not sacrifice motivation/method/experiments detail to make a pretty summary.",
    "",
    "Strict rules:",
    "- Do not invent affiliations, experimental results, speedups, datasets, chips, process nodes, metrics, or baselines.",
    "- If evidence is missing, explicitly say 摘要/PDF可读部分未披露.",
    "- Avoid vague phrases like 提升性能 or 提出一种方法 unless followed by concrete mechanism/evidence.",
    "- If motivationZh, methodZh, or experimentsZh is vague, generic, unsupported, or too short, mark workflow.digestStatus as failed instead of pretending the paper has been analyzed.",
    outputMode === "file"
      ? "- When editing the file, write valid JSON. Do not change unrelated papers."
      : "- Output valid JSON only. No Markdown fences.",
    "",
    "Required output schema:",
    JSON.stringify({
      papers: [
        {
          id: "original paper id",
          digest: {
            summaryZh: "80-140字中文摘要",
            motivationZh: "高信息密度动机，必须具体说明问题/重要性/瓶颈/用户相关性",
            methodZh: "高信息密度方法，必须具体说明核心机制/组件/新意/软硬件属性",
            experimentsZh: "高信息密度实验结果，必须具体说明设置/基线/指标/结果；没有证据就说明未披露",
            affiliationsZh: "作者单位；没有可靠证据写未在 DBLP/arXiv 元数据中提供",
            tags: ["3到6个中文关键词"],
            importance: 4,
            researchFitZh: "这篇论文与用户研究方向的关系",
            hardwareRelevance: 5,
            algorithmRelevance: 2,
            systemRelevance: 4,
            readPriority: "deep-read | skim | archive | reject",
            whyReadZh: "为什么值得/不值得继续读",
            limitationsZh: "证据缺口、适用边界或摘要/PDF未披露之处",
            motivationDetail: {
              problemZh: "具体问题",
              gapZh: "已有方法瓶颈",
              whyImportantZh: "为什么重要",
              userRelevanceZh: "和用户方向的关系",
              evidence: "abstract / intro / pdf page"
            },
            methodDetail: {
              coreIdeaZh: "核心想法",
              componentsZh: ["关键组件"],
              hardwareSystemDetailZh: "数据流/存储/调度/量化执行/硬件系统细节；没有就说明未披露",
              noveltyZh: "相对已有方法的新意",
              evidence: "method / design / abstract"
            },
            experimentDetail: {
              setupZh: "模型/任务/数据集/硬件平台",
              baselinesZh: "对比基线",
              metricsZh: ["latency", "throughput", "energy"],
              mainResultsZh: "主要结果",
              limitationsZh: "实验边界或未披露项",
              evidence: "evaluation / abstract / not disclosed"
            },
            evidence: {
              usedSources: ["metadata", "abstract"],
              affiliationEvidence: "来源说明",
              experimentEvidence: "来源说明",
              missingFields: []
            },
            confidence: {
              summary: 0.9,
              motivation: 0.8,
              method: 0.8,
              experiments: 0.7,
              affiliations: 0.6
            }
          },
          workflow: {
            digestStatus: "ready | failed",
            emailStatus: "ready | waiting-digest",
            harnessVersion: HARNESS_VERSION,
            harnessCheckedAt: "ISO timestamp",
            digestError: ""
          }
        }
      ]
    }, null, 2),
    "",
    "Papers to process:",
    JSON.stringify(compactPapers, null, 2)
  ].join("\n");
}

export function compactPaperForHarness(paper) {
  return {
    id: paper.id,
    title: paper.title,
    source: paper.source,
    authors: paper.authors ?? [],
    authorAffiliations: paper.authorAffiliations ?? [],
    affiliations: paper.affiliations ?? [],
    venue: paper.venue ?? "",
    published: paper.published ?? "",
    categories: paper.categories ?? [],
    abstract: paper.abstract ?? "",
    collectionType: paper.collectionType ?? "",
    collectionTypes: paper.collectionTypes ?? [],
    recommendationTrack: paper.recommendationTrack ?? "",
    recommendationLabel: paper.recommendationLabel ?? "",
    recommendationScore: paper.recommendationScore ?? 0,
    relevanceReason: paper.relevanceReason ?? "",
    url: paper.url ?? "",
    pdfUrl: paper.pdfUrl ?? "",
    localPdfPath: paper.localPdfPath ?? "",
    pdfStatus: paper.pdfStatus ?? "",
    workflow: paper.workflow ?? {}
  };
}

export function validateDigestObject(digest, paper = {}) {
  const issues = [];
  const warnings = [];

  requireText(digest, "summaryZh", issues, 40, "summaryZh 太短或缺失");
  requireRichText(digest, "motivationZh", issues, "motivation");
  requireRichText(digest, "methodZh", issues, "method");
  requireRichText(digest, "experimentsZh", issues, "experiments");
  requireText(digest, "affiliationsZh", issues, 4, "affiliationsZh 缺失");
  requireText(digest, "researchFitZh", issues, 16, "researchFitZh 缺失或过短");
  requireText(digest, "whyReadZh", issues, 16, "whyReadZh 缺失或过短");
  requireText(digest, "limitationsZh", warnings, 8, "limitationsZh 缺失或过短");

  if (!Array.isArray(digest.tags) || digest.tags.length < 3) {
    issues.push("tags 至少需要 3 个关键词");
  }

  requireScore(digest, "importance", issues);
  requireScore(digest, "hardwareRelevance", issues);
  requireScore(digest, "algorithmRelevance", issues);
  requireScore(digest, "systemRelevance", issues);

  if (!READ_PRIORITIES.includes(digest.readPriority)) {
    issues.push(`readPriority 必须是 ${READ_PRIORITIES.join("/")}`);
  }

  validateMotivationDetail(digest.motivationDetail, issues);
  validateMethodDetail(digest.methodDetail, issues);
  validateExperimentDetail(digest.experimentDetail, issues);
  validateEvidence(digest, paper, issues, warnings);
  validateConfidence(digest.confidence, warnings);

  return { issues, warnings };
}

export function validatePaperHarness(paper) {
  if (!paper.digest || !hasUsableDigest(paper)) {
    return {
      id: paper.id,
      title: paper.title,
      issues: ["缺少可用 digest 或仍是 fallback digest"],
      warnings: []
    };
  }

  const result = validateDigestObject(paper.digest, paper);
  return {
    id: paper.id,
    title: paper.title,
    ...result
  };
}

export function applyHarnessValidation(paper, validation, checkedAt = new Date().toISOString()) {
  const ready = validation.issues.length === 0;
  return {
    ...paper,
    workflow: {
      ...(paper.workflow ?? {}),
      digestStatus: ready ? "ready" : "failed",
      emailStatus: ready && isUnpushedPaper(paper) ? "ready" : "waiting-digest",
      harnessVersion: HARNESS_VERSION,
      harnessCheckedAt: checkedAt,
      digestError: ready ? "" : validation.issues.join("; "),
      harnessWarnings: validation.warnings
    }
  };
}

export function buildHarnessStats(digest) {
  const papers = Array.isArray(digest.papers) ? digest.papers : [];
  return {
    pendingDigest: papers.filter((paper) => !hasUsableDigest(paper)).length,
    pendingEmail: papers.filter((paper) => isUnpushedPaper(paper) && isReadyForEmail(paper)).length,
    failedDigest: papers.filter((paper) => paper.workflow?.digestStatus === "failed").length,
    pushed: papers.filter((paper) => paper.pushedAt || paper.emailSentAt).length
  };
}

export function isReadyForEmail(paper) {
  return hasUsableDigest(paper) && paper.workflow?.digestStatus === "ready";
}

function validateMotivationDetail(detail, issues) {
  if (!detail || typeof detail !== "object") {
    issues.push("motivationDetail 缺失");
    return;
  }
  requireText(detail, "problemZh", issues, 12, "motivationDetail.problemZh 缺失或过短");
  requireText(detail, "gapZh", issues, 12, "motivationDetail.gapZh 缺失或过短");
  requireText(detail, "whyImportantZh", issues, 12, "motivationDetail.whyImportantZh 缺失或过短");
  requireText(detail, "userRelevanceZh", issues, 12, "motivationDetail.userRelevanceZh 缺失或过短");
  requireText(detail, "evidence", issues, 4, "motivationDetail.evidence 缺失");
}

function validateMethodDetail(detail, issues) {
  if (!detail || typeof detail !== "object") {
    issues.push("methodDetail 缺失");
    return;
  }
  requireText(detail, "coreIdeaZh", issues, 12, "methodDetail.coreIdeaZh 缺失或过短");
  if (!Array.isArray(detail.componentsZh) || detail.componentsZh.length === 0) {
    issues.push("methodDetail.componentsZh 至少需要 1 项");
  }
  requireText(detail, "hardwareSystemDetailZh", issues, 8, "methodDetail.hardwareSystemDetailZh 缺失");
  requireText(detail, "noveltyZh", issues, 12, "methodDetail.noveltyZh 缺失或过短");
  requireText(detail, "evidence", issues, 4, "methodDetail.evidence 缺失");
}

function validateExperimentDetail(detail, issues) {
  if (!detail || typeof detail !== "object") {
    issues.push("experimentDetail 缺失");
    return;
  }
  requireText(detail, "setupZh", issues, 8, "experimentDetail.setupZh 缺失");
  requireText(detail, "baselinesZh", issues, 6, "experimentDetail.baselinesZh 缺失");
  if (!Array.isArray(detail.metricsZh) || detail.metricsZh.length === 0) {
    issues.push("experimentDetail.metricsZh 至少需要 1 项，未披露时写 未披露");
  }
  requireText(detail, "mainResultsZh", issues, 8, "experimentDetail.mainResultsZh 缺失");
  requireText(detail, "limitationsZh", issues, 8, "experimentDetail.limitationsZh 缺失");
  requireText(detail, "evidence", issues, 4, "experimentDetail.evidence 缺失");
}

function validateEvidence(digest, paper, issues, warnings) {
  const evidence = digest.evidence;
  if (!evidence || typeof evidence !== "object") {
    issues.push("evidence 缺失");
    return;
  }
  if (!Array.isArray(evidence.usedSources) || evidence.usedSources.length === 0) {
    issues.push("evidence.usedSources 至少需要包含 metadata 或 abstract");
  }
  if (!containsUnknownAffiliation(digest.affiliationsZh) && !cleanText(evidence.affiliationEvidence)) {
    issues.push("作者单位不是未提供时，evidence.affiliationEvidence 必须说明来源");
  }
  if (hasConcreteNumber(digest.experimentsZh) && !cleanText(evidence.experimentEvidence)) {
    issues.push("experimentsZh 包含具体数值时，evidence.experimentEvidence 必须说明来源");
  }
  if (paper.localPdfPath && !evidence.usedSources?.some((source) => String(source).includes("pdf"))) {
    warnings.push("存在 localPdfPath，但 evidence.usedSources 未说明是否读取 PDF");
  }
  if (!Array.isArray(evidence.missingFields)) {
    warnings.push("evidence.missingFields 建议使用数组");
  }
}

function validateConfidence(confidence, warnings) {
  if (!confidence || typeof confidence !== "object") {
    warnings.push("confidence 缺失");
    return;
  }
  for (const key of ["summary", "motivation", "method", "experiments", "affiliations"]) {
    const value = Number(confidence[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      warnings.push(`confidence.${key} 应为 0 到 1`);
    }
  }
}

function requireRichText(target, key, issues, label) {
  const value = cleanText(target?.[key]);
  if (value.length < 30) {
    issues.push(`${key} 缺失或过短，${label} 必须是高信息密度字段`);
    return;
  }
  if (GENERIC_PATTERNS.some((pattern) => value.includes(pattern)) && value.length < 70) {
    issues.push(`${key} 过于空泛，需要给出具体问题、机制或证据`);
  }
}

function requireText(target, key, issues, minLength, message) {
  if (cleanText(target?.[key]).length < minLength) {
    issues.push(message);
  }
}

function requireScore(target, key, issues) {
  const value = Number.parseInt(target?.[key], 10);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    issues.push(`${key} 必须是 1 到 5 的整数`);
  }
}

function containsUnknownAffiliation(value) {
  return /未(在|提供|披露)|无可靠|not\s+provided/i.test(cleanText(value));
}

function hasConcreteNumber(value) {
  return /(\d+(\.\d+)?\s*(x|×|%|倍|ms|s|tokens\/s|GB\/s|TOPS|W|J|MB|GB|FPS|latency|throughput|speedup))/i.test(cleanText(value));
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
