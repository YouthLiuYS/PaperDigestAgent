const state = {
  digest: { papers: [], stats: {} },
  historyDigest: { papers: [], stats: {} },
  dailyDigest: { papers: [], stats: {} },
  query: "",
  source: "all",
  sort: "recommendation"
};

const elements = {
  total: document.querySelector("#stat-total"),
  current: document.querySelector("#stat-current"),
  newlyAdded: document.querySelector("#stat-new"),
  time: document.querySelector("#stat-time"),
  search: document.querySelector("#search-input"),
  source: document.querySelector("#source-select"),
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
    pushed: papers.filter((paper) => paper.pushedAt || paper.emailSentAt).length
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

  elements.sort.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderPapers();
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
          const digest = imported.get(paper.id);
          return digest ? { ...paper, digest } : paper;
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

  return `
    <article class="paper-card">
      <div class="meta-row">
        <span class="source-badge">${escapeHtml(paper.source ?? "Unknown")}</span>
        ${collectionLabels.map((label) => `<span class="mode-badge">${escapeHtml(label)}</span>`).join("")}
        ${paper.recommendationLabel ? `<span class="track-badge">${escapeHtml(paper.recommendationLabel)}</span>` : ""}
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
      </div>
      <div class="paper-actions">
        ${paper.url ? `<a href="${escapeAttribute(paper.url)}" target="_blank" rel="noopener noreferrer">打开论文</a>` : ""}
        ${paper.pdfUrl ? `<a href="${escapeAttribute(paper.pdfUrl)}" target="_blank" rel="noopener noreferrer">PDF</a>` : ""}
      </div>
    </article>
  `;
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
    venue: paper.venue ?? "",
    published: paper.published ?? "",
    categories: paper.categories ?? [],
    abstract: paper.abstract ?? "",
    recommendationTrack: paper.recommendationTrack ?? "",
    relevanceReason: paper.relevanceReason ?? "",
    url: paper.url ?? ""
  }));

  return [
    "你是严谨的中文科研论文速递编辑。",
    "请只根据给定元数据和摘要写作，不要编造作者单位、实验结果或结论。",
    "如果元数据没有提供作者单位，请写“未在 DBLP/arXiv 元数据中提供”。",
    "请返回严格 JSON，不要 Markdown，不要代码块。",
    "JSON schema:",
    "{\"papers\":[{\"id\":\"原论文 id\",\"digest\":{\"summaryZh\":\"80 到 140 字中文摘要\",\"motivationZh\":\"研究动机\",\"methodZh\":\"核心方法\",\"experimentsZh\":\"实验设置和结果；没有就说明摘要未披露\",\"affiliationsZh\":\"作者单位\",\"tags\":[\"关键词\"],\"importance\":3}}]}",
    "待处理论文:",
    JSON.stringify(compactPapers, null, 2)
  ].join("\n\n");
}

function normalizeImportedDigests(value) {
  const papers = Array.isArray(value?.papers) ? value.papers : Array.isArray(value) ? value : [];
  const digests = new Map();

  for (const item of papers) {
    if (!item?.id || !item?.digest) continue;
    digests.set(item.id, {
      summaryZh: cleanText(item.digest.summaryZh),
      motivationZh: cleanText(item.digest.motivationZh),
      methodZh: cleanText(item.digest.methodZh),
      experimentsZh: cleanText(item.digest.experimentsZh),
      affiliationsZh: cleanText(item.digest.affiliationsZh),
      tags: Array.isArray(item.digest.tags) ? item.digest.tags.map(cleanText).filter(Boolean).slice(0, 6) : [],
      importance: clamp(Number.parseInt(item.digest.importance, 10) || 3, 1, 5)
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
