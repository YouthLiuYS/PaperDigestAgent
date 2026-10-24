export function validPaper(id = "smtp-test") {
  const text = "这是队列与邮件集成测试的专用描述，用于验证元数据保存以及结构化摘要字段的完整性，不代表真实论文结论。";
  return {
    id,
    title: "Synthetic integration test paper",
    source: "arXiv",
    url: "https://example.invalid/paper",
    authors: ["Test Author"],
    published: "2026-10-24",
    digest: {
      summaryZh: text, motivationZh: text, methodZh: text, experimentsZh: text,
      affiliationsZh: "未在 DBLP/arXiv 元数据中提供",
      tags: ["测试", "队列", "邮件"], importance: 3,
      researchFitZh: text, hardwareRelevance: 3, algorithmRelevance: 2, systemRelevance: 3,
      readPriority: "skim", whyReadZh: text, limitationsZh: text,
      motivationDetail: { problemZh: text, gapZh: text, whyImportantZh: text, userRelevanceZh: text, evidence: "test metadata" },
      methodDetail: { coreIdeaZh: text, componentsZh: [text], hardwareSystemDetailZh: text, noveltyZh: text, evidence: "test abstract" },
      experimentDetail: { setupZh: text, baselinesZh: text, metricsZh: ["未披露"], mainResultsZh: text, limitationsZh: text, evidence: "not disclosed" },
      evidence: { usedSources: ["metadata"], affiliationEvidence: "not provided", experimentEvidence: "not disclosed", missingFields: [] },
      confidence: { summary: 0.5, motivation: 0.5, method: 0.5, experiments: 0.5, affiliations: 0.5 }
    },
    workflow: { digestStatus: "ready", emailStatus: "ready", harnessVersion: "paper-reader-v1" }
  };
}
