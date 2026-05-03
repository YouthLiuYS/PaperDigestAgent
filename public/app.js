const state = {
  digest: { papers: [], stats: {} },
  historyDigest: { papers: [], stats: {} },
  dailyDigest: { papers: [], stats: {} },
  query: "",
  source: "all",
  status: "all",
  view: "all",
  sort: "recommendation",
  marks: loadUserMarks()
};

const HARNESS_VERSION = "paper-reader-v1";

const elements = {
  total: document.querySelector("#stat-total"),
  current: document.querySelector("#stat-current"),
  newlyAdded: document.querySelector("#stat-new"),
  time: document.querySelector("#stat-time"),
  search: document.querySelector("#search-input"),
  source: document.querySelector("#source-select"),
  status: document.querySelector("#status-select"),
  view: document.querySelector("#view-select"),
  sort: document.querySelector("#sort-select"),
  promptOutput: document.querySelector("#prompt-output"),
  digestInput: document.querySelector("#digest-input"),
  copyPrompt: document.querySelector("#copy-prompt-button"),
  saveDigest: document.querySelector("#save-digest-button"),
  workbenchStatus: document.querySelector("#workbench-status"),
  empty: document.querySelector("#empty-state"),
  list: document.querySelector("#paper-list")
};

init();

async function init() {
  bindControls();

  try {
    const [historyData, dailyData] = await Promise.all([
      fetchDigest("research-digest/papers.json"),
      fetchDigest("research-digest/daily.json", true)
    ]);
    state.historyDigest = normalizeDigest(historyData);
    state.dailyDigest = normalizeDigest(dailyData ?? { kind: "daily-new", papers: [] });
    state.digest = buildCombinedDigest();
    renderSources();
    renderStats();
    renderWorkbench();
    renderPapers();
  } catch {
    elements.empty.textContent = "论文数据暂不可用。";
  }
}

async function fetchDigest(url, optional = false) {
  const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    if (optional && response.status === 404) return null;
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function normalizeDigest(data) {
  const digest = { ...data, papers: Array.isArray(data?.papers) ? data.papers : [], stats: data?.stats ?? {} };
  if (digest.kind === "daily-new" || digest.digestDate) {
    digest.stats = buildDailyStats(digest.papers, digest.stats);
  }
  return digest;
}

function buildCombinedDigest() {
  const papers = dedupePapers([...(state.dailyDigest.papers ?? []), ...(state.historyDigest.papers ?? [])]);
  return {
    ...state.historyDigest,
    generatedAt: state.dailyDigest.generatedAt ?? state.historyDigest.generatedAt,
    papers,
    stats: {
      ...(state.historyDigest.stats ?? {}),
      current: state.dailyDigest.stats?.total ?? state.dailyDigest.papers?.length ?? 0,
      newlyAdded: state.dailyDigest.stats?.newlyAdded ?? 0,
      pendingDigest: state.dailyDigest.stats?.pendingDigest ?? 0,
      pendingEmail: state.dailyDigest.stats?.pendingEmail ?? 0
    }
  };
}

function buildDailyStats(papers, previousStats = {}) {
  return {
    ...previousStats,
    total: papers.length,
    current: papers.length,
    pendingDigest: papers.filter((paper) => !hasUsableDigest(paper)).length,
    pendingEmail: papers.filter((paper) => !paper.pushedAt && !paper.emailSentAt && hasUsableDigest(paper)).length,
    pushed: papers.filter((paper) => paper.pushedAt || paper.emailSentAt).length,
    failedDigest: papers.filter((paper) => getPaperWorkflow(paper).digestStatus === "failed").length,
    failedEmail: papers.filter((paper) => getPaperWorkflow(paper).emailStatus === "failed").length,
    pdfDownloaded: papers.filter((paper) => paper.pdfStatus === "downloaded" || paper.localPdfPath).length
  };
}

function dedupePapers(papers) {
  const map = new Map();
  for (const paper of papers) {
    const key = paper.id || titleKey(paper.title);
    if (!key) continue;
    const existing = map.get(key);
    map.set(key, existing ? { ...paper, ...existing, digest: existing.digest ?? paper.digest } : paper);
  }
  return Array.from(map.values());
}

function bindControls() {
  elements.search.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    renderPapers();
  });

  elements.source.addEventListener("change", (event) => {
    state.source = event.target.value;
    renderPapers();
  });

  elements.status.addEventListener("change", (event) => {
    state.status = event.target.value;
    renderPapers();
  });

  elements.view.addEventListener("change", (event) => {
    state.view = event.target.value;
    renderPapers();
  });

  elements.sort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderPapers();
  });

  elements.list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-paper-action]");
    if (!button) return;
    togglePaperMark(button.dataset.paperKey, button.dataset.paperAction);
  });

  elements.copyPrompt.addEventListener("click", async () => {
    const prompt = buildDigestPrompt();
    elements.promptOutput.value = prompt;
    await navigator.clipboard?.writeText(prompt);
    setWorkbenchStatus("提示词已复制");
  });

  elements.saveDigest.addEventListener("click", async () => {
    try {
      const imported = normalizeImportedDigests(parseJsonFromText(elements.digestInput.value));
      if (imported.size === 0) {
        throw new Error("没有识别到摘要 JSON。");
      }

      state.dailyDigest = {
        ...state.dailyDigest,
        papers: state.dailyDigest.papers.map((paper) => {
          const update = imported.get(paper.id);
          return update ? {
            ...paper,
            digest: update.digest,
            workflow: {
              ...(paper.workflow ?? {}),
              ...update.workflow
            }
          } : paper;
        })
      };
      state.dailyDigest = {
        ...state.dailyDigest,
        generatedAt: new Date().toISOString(),
        stats: buildDailyStats(state.dailyDigest.papers, state.dailyDigest.stats)
      };
      state.digest = buildCombinedDigest();

      await saveDigestToServer();
      renderStats();
      renderWorkbench();
      renderPapers();
      setWorkbenchStatus(`已保存 ${imported.size} 篇摘要`);
    } catch (error) {
      setWorkbenchStatus(error instanceof Error ? error.message : String(error));
    }
  });
}

function renderSources() {
  const sources = Array.from(new Set(state.digest.papers.map((paper) => paper.source).filter(Boolean))).sort();
  elements.source.innerHTML = `<option value="all">全部</option>${sources.map((source) => `<option value="${escapeAttribute(source)}">${escapeHtml(source)}</option>`).join("")}`;
}

function renderStats() {
  const historyStats = state.historyDigest.stats ?? {};
  const dailyStats = state.dailyDigest.stats ?? {};
  elements.total.textContent = historyStats.total ?? state.historyDigest.papers.length ?? 0;
  elements.current.textContent = dailyStats.total ?? state.dailyDigest.papers.length ?? 0;
  elements.newlyAdded.textContent = dailyStats.pendingEmail ?? 0;
  elements.time.textContent = state.dailyDigest.generatedAt ? formatDateTime(state.dailyDigest.generatedAt) : "待运行";
}

function renderWorkbench() {
  const pendingPapers = getPendingDigestPapers();
  elements.promptOutput.value = buildDigestPrompt(pendingPapers);
  setWorkbenchStatus(`待摘要论文 ${pendingPapers.length} 篇`);
}

function renderPapers() {
  const papers = state.digest.papers
    .filter((paper) => state.source === "all" || paper.source === state.source)
    .filter(matchesStatus)
    .filter(matchesView)
    .filter(matchesQuery)
    .sort(comparePapers);

  elements.empty.hidden = papers.length > 0;
  if (papers.length === 0) {
    elements.empty.textContent = state.digest.papers.length === 0 ? "暂无论文数据。" : "暂无匹配论文。";
  }

  elements.list.innerHTML = papers.map(renderPaper).join("");
}

function matchesQuery(paper) {
  if (!state.query) return true;

  return [
    paper.title,
    paper.venue,
    paper.matchedQuery,
    paper.authors?.join(" "),
    paper.digest?.summaryZh,
    paper.digest?.motivationZh,
    paper.digest?.methodZh,
    paper.digest?.tags?.join(" "),
    paper.targetThemes?.join(" "),
    paper.conferenceVenues?.join(" "),
    paper.conferenceYears?.join(" "),
    paper.collectionTypes?.join(" "),
    paper.recommendationTrack,
    paper.recommendationLabel,
    paper.relevanceReason
  ].join(" ").toLowerCase().includes(state.query);
}

function matchesStatus(paper) {
  if (state.status === "all") return true;
  if (state.status === "pending-digest") return !hasUsableDigest(paper);
  if (state.status === "pending-email") return !paper.pushedAt && !paper.emailSentAt && hasUsableDigest(paper);
  if (state.status === "pushed") return Boolean(paper.pushedAt || paper.emailSentAt);
  if (state.status === "failed") {
    const workflow = getPaperWorkflow(paper);
    return workflow.digestStatus === "failed" || workflow.emailStatus === "failed" || paper.pdfStatus === "failed";
  }
  if (state.status === "pdf") return paper.pdfStatus === "downloaded" || Boolean(paper.localPdfPath);
  return true;
}

function matchesView(paper) {
  const mark = getPaperMark(paper);
  if (state.view === "favorites") return Boolean(mark.favorite);
  if (state.view === "read") return Boolean(mark.read);
  if (state.view === "unread") return !mark.read;
  return true;
}

function comparePapers(a, b) {
  if (state.sort === "recommendation") {
    return recommendationRank(a) - recommendationRank(b)
      || (b.recommendationScore ?? 0) - (a.recommendationScore ?? 0)
      || compareDateDesc(a, b);
  }

  if (state.sort === "importance") {
    return (b.digest?.importance ?? 0) - (a.digest?.importance ?? 0);
  }

  if (state.sort === "source") {
    return String(a.source ?? "").localeCompare(String(b.source ?? "")) || compareDateDesc(a, b);
  }

  return compareDateDesc(a, b);
}

function recommendationRank(paper) {
  if (paper.recommendationTrack === "hardware-primary") return 0;
  if (paper.recommendationTrack === "algorithm-trend") return 1;
  if (paper.recommendationTrack === "off-topic") return 3;
  return 2;
}

function renderPaper(paper) {
  const digest = paper.digest ?? {};
  const tags = (digest.tags ?? paper.categories ?? []).filter(Boolean).slice(0, 6);
  const collectionLabels = getCollectionLabels(paper);
  const mark = getPaperMark(paper);
  const paperKey = paperStorageKey(paper);
  const workflow = getPaperWorkflow(paper);

  return `
    <article class="paper-card ${mark.favorite ? "is-favorite" : ""} ${mark.read ? "is-read" : ""}">
      <div class="meta-row">
        <span class="source-badge">${escapeHtml(paper.source ?? "Unknown")}</span>
        ${collectionLabels.map((label) => `<span class="mode-badge">${escapeHtml(label)}</span>`).join("")}
        ${paper.recommendationLabel ? `<span class="track-badge">${escapeHtml(paper.recommendationLabel)}</span>` : ""}
        ${renderWorkflowBadge(workflow.digestStatus)}
        ${renderPdfBadge(paper)}
        <span>${escapeHtml(formatDate(paper.published || paper.updated))}</span>
        ${paper.venue ? `<span>${escapeHtml(paper.venue)}</span>` : ""}
        <span>重要度 ${escapeHtml(digest.importance ?? 3)}/5</span>
      </div>
      <h2>${escapeHtml(paper.title ?? "Untitled")}</h2>
      ${paper.authors?.length ? `<p class="authors">${escapeHtml(paper.authors.join(", "))}</p>` : ""}
      ${tags.length ? `<div class="tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      ${digest.summaryZh ? `<p class="summary">${escapeHtml(digest.summaryZh)}</p>` : ""}
      <div class="field-grid">
        ${renderField("Motivation", digest.motivationZh)}
        ${renderField("Method", digest.methodZh)}
        ${renderField("实验结果", digest.experimentsZh)}
        ${renderField("作者单位", digest.affiliationsZh)}
        ${renderField("为什么值得读", digest.whyReadZh)}
        ${renderField("相关度", renderRelevanceText(digest))}
      </div>
      ${renderDetailSection(digest)}
      <div class="paper-actions">
        ${paper.url ? `<a href="${escapeAttribute(paper.url)}" target="_blank" rel="noopener noreferrer">打开论文</a>` : ""}
        ${paper.pdfUrl ? `<a href="${escapeAttribute(paper.pdfUrl)}" target="_blank" rel="noopener noreferrer">PDF</a>` : ""}
        ${paper.localPdfUrl ? `<a href="${escapeAttribute(paper.localPdfUrl)}" target="_blank" rel="noopener noreferrer">本地 PDF</a>` : ""}
        <button class="mark-button ${mark.favorite ? "active" : ""}" type="button" data-paper-action="favorite" data-paper-key="${escapeAttribute(paperKey)}">${mark.favorite ? "已收藏" : "收藏"}</button>
        <button class="mark-button ${mark.read ? "active" : ""}" type="button" data-paper-action="read" data-paper-key="${escapeAttribute(paperKey)}">${mark.read ? "已读" : "标为已读"}</button>
      </div>
    </article>
  `;
}

function renderWorkflowBadge(status) {
  if (status === "ready") return `<span class="status-badge ready">摘要完成</span>`;
  if (status === "failed") return `<span class="status-badge failed">摘要失败</span>`;
  if (status === "pending") return `<span class="status-badge pending">待摘要</span>`;
  return "";
}

function renderPdfBadge(paper) {
  if (paper.pdfStatus === "downloaded" || paper.localPdfPath) return `<span class="status-badge ready">PDF 已缓存</span>`;
  if (paper.pdfStatus === "failed") return `<span class="status-badge failed">PDF 失败</span>`;
  return "";
}

function getCollectionLabels(paper) {
  const types = paper.collectionTypes ?? [paper.collectionType];
  return types.filter(Boolean).map((type) => {
    if (type === "daily-latest") return "每日最新";
    if (type === "conference-archive") return "往年会议";
    return type;
  });
}

function getPendingDigestPapers() {
  return state.dailyDigest.papers.filter((paper) => !paper.pushedAt && !paper.emailSentAt && !hasUsableDigest(paper)).slice(0, 10);
}

function hasUsableDigest(paper) {
  const summary = paper.digest?.summaryZh ?? "";
  const text = [
    paper.digest?.summaryZh,
    paper.digest?.motivationZh,
    paper.digest?.methodZh,
    paper.digest?.experimentsZh
  ].join(" ");
  return Boolean(summary && !["AI 摘要未生成", "命令行启用了 --no-ai", "AI 调用失败", "未配置 PAPER_AGENT_AI_API_KEY"].some((marker) => text.includes(marker)));
}

function buildDigestPrompt(papers = getPendingDigestPapers()) {
  const compactPapers = papers.map((paper) => ({
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
    recommendationTrack: paper.recommendationTrack ?? "",
    relevanceReason: paper.relevanceReason ?? "",
    url: paper.url ?? "",
    pdfUrl: paper.pdfUrl ?? "",
    localPdfPath: paper.localPdfPath ?? "",
    pdfStatus: paper.pdfStatus ?? "",
    workflow: getPaperWorkflow(paper)
  }));

  return [
    `你是 PaperDigestAgent 的 ${HARNESS_VERSION} 论文阅读 harness。`,
    "用户最看重 motivation、method 和 experiments/results；这三项必须具体、可验证、高信息密度，summaryZh 只是辅助字段。",
    "用户方向：AI 处理器芯片和体系结构、大模型量化算法与体系结构、大模型软硬件协同优化、大模型训推系统优化、KV cache/近存计算/PIM、AI accelerator/NPU/GPU/TPU/chiplet、agent 软硬件协同优化。算法趋势只作为辅助观察。",
    "阅读协议：L0 先读元数据和 abstract；L1 如果 localPdfPath 可读，优先读 PDF 前两页提取作者单位和问题定义；L2 只对硬件主线/系统相关/重要度高的论文继续读 method/design/evaluation。",
    "motivationZh 必须回答具体问题、为什么重要、已有瓶颈、和用户方向的关系。",
    "methodZh 必须回答核心机制、关键组件、算法/系统/体系结构/硬件属性、相对已有方法的新意。",
    "experimentsZh 必须回答实验设置、对比基线、指标、主要结果；没有证据就写“摘要/PDF可读部分未披露”。",
    "请只根据给定元数据、摘要和可读取 PDF 写作，不要编造作者单位、实验结果、加速比、数据集、芯片、工艺节点或指标。",
    "如果 motivationZh、methodZh 或 experimentsZh 空泛、过短或缺证据，请把 workflow.digestStatus 标为 failed。",
    "请返回严格 JSON，不要 Markdown，不要代码块。",
    "JSON schema:",
    JSON.stringify({
      papers: [
        {
          id: "原论文 id",
          digest: {
            summaryZh: "80 到 140 字中文摘要",
            motivationZh: "具体问题/重要性/已有瓶颈/用户相关性",
            methodZh: "核心机制/关键组件/软硬件属性/新意",
            experimentsZh: "实验设置/基线/指标/结果；没有证据写未披露",
            affiliationsZh: "作者单位；没有可靠证据写未在 DBLP/arXiv 元数据中提供",
            tags: ["关键词"],
            importance: 3,
            researchFitZh: "和用户方向的关系",
            hardwareRelevance: 5,
            algorithmRelevance: 2,
            systemRelevance: 4,
            readPriority: "deep-read | skim | archive | reject",
            whyReadZh: "为什么值得/不值得继续读",
            limitationsZh: "证据缺口或适用边界",
            motivationDetail: {
              problemZh: "具体问题",
              gapZh: "已有方法瓶颈",
              whyImportantZh: "为什么重要",
              userRelevanceZh: "和用户方向的关系",
              evidence: "证据来源"
            },
            methodDetail: {
              coreIdeaZh: "核心想法",
              componentsZh: ["关键组件"],
              hardwareSystemDetailZh: "数据流/存储/调度/量化执行/硬件系统细节；没有就说明未披露",
              noveltyZh: "新意",
              evidence: "证据来源"
            },
            experimentDetail: {
              setupZh: "模型/任务/数据集/硬件平台",
              baselinesZh: "对比基线",
              metricsZh: ["latency", "throughput"],
              mainResultsZh: "主要结果",
              limitationsZh: "实验边界或未披露项",
              evidence: "证据来源"
            },
            evidence: {
              usedSources: ["metadata", "abstract"],
              affiliationEvidence: "作者单位证据",
              experimentEvidence: "实验结果证据",
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
            digestError: ""
          }
        }
      ]
    }),
    "待处理论文:",
    JSON.stringify(compactPapers, null, 2)
  ].join("\n\n");
}

function togglePaperMark(key, action) {
  if (!key || !["favorite", "read"].includes(action)) return;
  const current = state.marks[key] ?? {};
  state.marks = {
    ...state.marks,
    [key]: {
      ...current,
      [action]: !current[action],
      updatedAt: new Date().toISOString()
    }
  };
  saveUserMarks(state.marks);
  renderPapers();
}

function getPaperMark(paper) {
  return state.marks[paperStorageKey(paper)] ?? {};
}

function getPaperWorkflow(paper) {
  const pushed = Boolean(paper.pushedAt || paper.emailSentAt);
  const digestReady = hasUsableDigest(paper);
  return {
    ...(paper.workflow ?? {}),
    collectStatus: "collected",
    digestStatus: digestReady ? "ready" : paper.workflow?.digestStatus ?? "pending",
    emailStatus: pushed ? "sent" : digestReady ? paper.workflow?.emailStatus === "failed" ? "failed" : "ready" : "waiting-digest",
    pdfStatus: paper.pdfStatus ?? paper.workflow?.pdfStatus ?? (paper.localPdfPath ? "downloaded" : paper.pdfUrl ? "remote" : "none")
  };
}

function paperStorageKey(paper) {
  return paper.id || titleKey(paper.title);
}

function loadUserMarks() {
  try {
    return JSON.parse(localStorage.getItem("paper-digest-agent:marks:v1") ?? "{}");
  } catch {
    return {};
  }
}

function saveUserMarks(marks) {
  try {
    localStorage.setItem("paper-digest-agent:marks:v1", JSON.stringify(marks));
  } catch {
    setWorkbenchStatus("浏览器未允许保存收藏状态");
  }
}

function normalizeImportedDigests(value) {
  const papers = Array.isArray(value?.papers) ? value.papers : Array.isArray(value) ? value : [];
  const digests = new Map();

  for (const item of papers) {
    if (!item?.id || !item?.digest) continue;
    digests.set(item.id, {
      digest: {
        summaryZh: cleanText(item.digest.summaryZh),
        motivationZh: cleanText(item.digest.motivationZh),
        methodZh: cleanText(item.digest.methodZh),
        experimentsZh: cleanText(item.digest.experimentsZh),
        affiliationsZh: cleanText(item.digest.affiliationsZh),
        tags: Array.isArray(item.digest.tags) ? item.digest.tags.map(cleanText).filter(Boolean).slice(0, 6) : [],
        importance: clamp(Number.parseInt(item.digest.importance, 10) || 3, 1, 5),
        researchFitZh: cleanText(item.digest.researchFitZh),
        hardwareRelevance: clamp(Number.parseInt(item.digest.hardwareRelevance, 10) || 1, 1, 5),
        algorithmRelevance: clamp(Number.parseInt(item.digest.algorithmRelevance, 10) || 1, 1, 5),
        systemRelevance: clamp(Number.parseInt(item.digest.systemRelevance, 10) || 1, 1, 5),
        readPriority: normalizeReadPriority(item.digest.readPriority),
        whyReadZh: cleanText(item.digest.whyReadZh),
        limitationsZh: cleanText(item.digest.limitationsZh),
        motivationDetail: normalizeMotivationDetail(item.digest.motivationDetail),
        methodDetail: normalizeMethodDetail(item.digest.methodDetail),
        experimentDetail: normalizeExperimentDetail(item.digest.experimentDetail),
        evidence: normalizeEvidence(item.digest.evidence),
        confidence: normalizeConfidence(item.digest.confidence)
      },
      workflow: {
        digestStatus: item.workflow?.digestStatus === "failed" ? "failed" : "ready",
        emailStatus: item.workflow?.digestStatus === "failed" ? "waiting-digest" : "ready",
        harnessVersion: HARNESS_VERSION,
        harnessCheckedAt: new Date().toISOString(),
        digestError: cleanText(item.workflow?.digestError)
      }
    });
  }

  return digests;
}

async function saveDigestToServer() {
  const response = await fetch("/api/daily-digest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.dailyDigest)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `保存失败：HTTP ${response.status}`);
  }
}

function renderField(label, value) {
  if (!value) return "";
  return `<section class="field"><h3>${escapeHtml(label)}</h3><p>${escapeHtml(value)}</p></section>`;
}

function renderDetailSection(digest) {
  const motivation = digest.motivationDetail;
  const method = digest.methodDetail;
  const experiment = digest.experimentDetail;
  if (!motivation && !method && !experiment) {
    return "";
  }

  return `
    <details class="detail-panel">
      <summary>Harness 细节</summary>
      <div class="detail-grid">
        ${renderDetailBlock("Motivation Detail", [
          ["问题", motivation?.problemZh],
          ["瓶颈", motivation?.gapZh],
          ["重要性", motivation?.whyImportantZh],
          ["相关性", motivation?.userRelevanceZh],
          ["证据", motivation?.evidence]
        ])}
        ${renderDetailBlock("Method Detail", [
          ["核心想法", method?.coreIdeaZh],
          ["组件", method?.componentsZh?.join("；")],
          ["系统/硬件细节", method?.hardwareSystemDetailZh],
          ["新意", method?.noveltyZh],
          ["证据", method?.evidence]
        ])}
        ${renderDetailBlock("Experiment Detail", [
          ["设置", experiment?.setupZh],
          ["基线", experiment?.baselinesZh],
          ["指标", experiment?.metricsZh?.join("；")],
          ["主要结果", experiment?.mainResultsZh],
          ["边界", experiment?.limitationsZh],
          ["证据", experiment?.evidence]
        ])}
      </div>
    </details>
  `;
}

function renderDetailBlock(title, rows) {
  const renderedRows = rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<p><strong>${escapeHtml(label)}：</strong>${escapeHtml(value)}</p>`)
    .join("");
  return renderedRows ? `<section class="detail-block"><h3>${escapeHtml(title)}</h3>${renderedRows}</section>` : "";
}

function renderRelevanceText(digest = {}) {
  return [
    digest.readPriority ? `阅读优先级 ${digest.readPriority}` : "",
    digest.hardwareRelevance ? `硬件 ${digest.hardwareRelevance}/5` : "",
    digest.systemRelevance ? `系统 ${digest.systemRelevance}/5` : "",
    digest.algorithmRelevance ? `算法 ${digest.algorithmRelevance}/5` : ""
  ].filter(Boolean).join(" · ");
}

function compareDateDesc(a, b) {
  return dateValue(b.published || b.updated || b.collectedAt) - dateValue(a.published || a.updated || a.collectedAt);
}

function dateValue(value) {
  const time = Date.parse(value ?? "");
  return Number.isNaN(time) ? 0 : time;
}

function formatDate(value) {
  if (!value) return "日期未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
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
    throw new Error("JSON 格式不正确。");
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeReadPriority(value) {
  return ["deep-read", "skim", "archive", "reject"].includes(value) ? value : "archive";
}

function normalizeMotivationDetail(value = {}) {
  return {
    problemZh: cleanText(value.problemZh),
    gapZh: cleanText(value.gapZh),
    whyImportantZh: cleanText(value.whyImportantZh),
    userRelevanceZh: cleanText(value.userRelevanceZh),
    evidence: cleanText(value.evidence)
  };
}

function normalizeMethodDetail(value = {}) {
  return {
    coreIdeaZh: cleanText(value.coreIdeaZh),
    componentsZh: Array.isArray(value.componentsZh) ? value.componentsZh.map(cleanText).filter(Boolean).slice(0, 8) : [],
    hardwareSystemDetailZh: cleanText(value.hardwareSystemDetailZh),
    noveltyZh: cleanText(value.noveltyZh),
    evidence: cleanText(value.evidence)
  };
}

function normalizeExperimentDetail(value = {}) {
  return {
    setupZh: cleanText(value.setupZh),
    baselinesZh: cleanText(value.baselinesZh),
    metricsZh: Array.isArray(value.metricsZh) ? value.metricsZh.map(cleanText).filter(Boolean).slice(0, 8) : [],
    mainResultsZh: cleanText(value.mainResultsZh),
    limitationsZh: cleanText(value.limitationsZh),
    evidence: cleanText(value.evidence)
  };
}

function normalizeEvidence(value = {}) {
  return {
    usedSources: Array.isArray(value.usedSources) ? value.usedSources.map(cleanText).filter(Boolean).slice(0, 8) : [],
    affiliationEvidence: cleanText(value.affiliationEvidence),
    experimentEvidence: cleanText(value.experimentEvidence),
    missingFields: Array.isArray(value.missingFields) ? value.missingFields.map(cleanText).filter(Boolean).slice(0, 12) : []
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

function titleKey(title) {
  return cleanText(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setWorkbenchStatus(message) {
  elements.workbenchStatus.textContent = message;
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
