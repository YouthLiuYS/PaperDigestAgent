#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HARNESS_VERSION,
  applyHarnessValidation,
  buildHarnessStats,
  isUnpushedPaper,
  readJson,
  validatePaperHarness,
  writeJson
} from "./harness-core.mjs";

export function mergeCloudDigests(daily, updates, checkedAt = new Date().toISOString()) {
  if (!Array.isArray(daily.papers) || !Array.isArray(updates.papers)) {
    throw new Error("Both daily queue and cloud updates must contain a papers array.");
  }
  if (updates.harnessVersion !== HARNESS_VERSION) {
    throw new Error(`Cloud updates must use ${HARNESS_VERSION}.`);
  }
  if (updates.papers.length === 0 || updates.digestDate !== daily.digestDate) {
    return { digest: daily, applied: 0, skipped: updates.papers.length };
  }

  const byId = new Map(daily.papers.map((paper) => [paper.id, paper]));
  const replacements = new Map();
  const seen = new Set();
  let skipped = 0;
  for (const update of updates.papers) {
    if (!update.id || seen.has(update.id)) {
      throw new Error(`Missing or repeated cloud paper id: ${update.id ?? "missing"}`);
    }
    seen.add(update.id);
    const paper = byId.get(update.id);
    if (!paper) {
      throw new Error(`Cloud update refers to unknown paper: ${update.id}`);
    }
    const currentValidation = validatePaperHarness(paper);
    if (!isUnpushedPaper(paper)
      || (paper.workflow?.digestStatus === "ready" && currentValidation.issues.length === 0)) {
      skipped += 1;
      continue;
    }
    // Only the digest is imported. Delivery flags and source metadata stay authoritative.
    const candidate = { ...paper, digest: update.digest };
    const validation = validatePaperHarness(candidate);
    if (validation.issues.length > 0) {
      throw new Error(`${paper.id}: ${validation.issues.join("; ")}`);
    }
    replacements.set(paper.id, applyHarnessValidation(candidate, validation, checkedAt));
  }
  if (replacements.size === 0) {
    return { digest: daily, applied: 0, skipped };
  }
  const papers = daily.papers.map((paper) => replacements.get(paper.id) ?? paper);
  return {
    digest: {
      ...daily,
      generatedAt: checkedAt,
      papers,
      stats: { ...daily.stats, ...buildHarnessStats({ papers }) }
    },
    applied: replacements.size,
    skipped
  };
}

export function readyPapersForCloudEmail(daily, history = { papers: [] }, { requireComplete = false } = {}) {
  if (!Array.isArray(daily.papers) || !Array.isArray(history.papers)) {
    throw new Error("Daily queue and history must contain papers arrays.");
  }
  const sentIds = new Set(history.papers
    .filter((paper) => paper.pushedAt || paper.emailSentAt)
    .map((paper) => paper.id));
  const ready = daily.papers.filter((paper) => isUnpushedPaper(paper)
    && paper.workflow?.digestStatus === "ready");
  for (const paper of ready) {
    if (sentIds.has(paper.id)) {
      throw new Error(`Refusing to resend a paper already present in sent history: ${paper.id}`);
    }
    const validation = validatePaperHarness(paper);
    if (validation.issues.length > 0) {
      throw new Error(`Refusing invalid ready digest ${paper.id}: ${validation.issues.join("; ")}`);
    }
  }
  const waiting = daily.papers.filter((paper) => isUnpushedPaper(paper)
    && paper.workflow?.digestStatus !== "ready");
  if (requireComplete && waiting.length > 0) {
    throw new Error(`Cloud email blocked: ${waiting.length} paper(s) still need validated cloud digests: ${waiting.map((paper) => paper.id).join(", ")}. Check the hosted task and GitHub approval status.`);
  }
  return ready;
}

async function main() {
  const command = process.argv[2];
  const daily = await readJson("public/research-digest/daily.json");
  if (command === "apply") {
    const updates = await readJson("data/cloud-digest-updates.json");
    const result = mergeCloudDigests(daily, updates);
    if (result.applied > 0) {
      await writeJson("public/research-digest/daily.json", result.digest);
    }
    console.log(`Cloud digests: ${result.applied} applied, ${result.skipped} skipped.`);
  } else if (command === "ready") {
    const ready = readyPapersForCloudEmail(daily, await readJson("public/research-digest/papers.json"), {
      requireComplete: process.argv.includes("--require-complete")
    });
    console.log(`Validated papers ready for cloud email: ${ready.length}.`);
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, `ready_count=${ready.length}\n`);
    }
    if (process.argv.includes("--require-smtp") && ready.length > 0) {
      const required = ["PAPER_AGENT_SMTP_HOST", "PAPER_AGENT_SMTP_PORT", "PAPER_AGENT_SMTP_USER",
        "PAPER_AGENT_SMTP_PASS", "PAPER_AGENT_MAIL_FROM", "PAPER_AGENT_MAIL_TO"];
      const missing = required.filter((key) => !process.env[key]?.trim());
      if (missing.length > 0) {
        throw new Error(`Missing GitHub Actions secrets: ${missing.join(", ")}`);
      }
    }
  } else {
    throw new Error("Usage: node scripts/cloud-digest.mjs apply|ready [--require-smtp] [--require-complete]");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
