#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  HARNESS_VERSION,
  applyHarnessValidation,
  buildHarnessPrompt,
  buildHarnessStats,
  needsHarnessDigest,
  readJson,
  repoRoot,
  validatePaperHarness,
  writeJson
} from "./harness-core.mjs";

const DEFAULT_CODEX_BIN = "/Applications/Codex.app/Contents/Resources/codex";
const args = parseArgs(process.argv.slice(2));
const dailyPath = args.input ?? "public/research-digest/daily.json";

if (args.pull) {
  await runCommand("git", ["pull", "--rebase", "--autostash"], { cwd: repoRoot });
}

const digest = await readJson(dailyPath);
const papers = Array.isArray(digest.papers) ? digest.papers : [];
const selected = papers
  .filter((paper) => args.all || needsHarnessDigest(paper))
  .filter((paper) => !args.id || paper.id === args.id)
  .slice(0, args.limit);

if (selected.length === 0) {
  console.log("No papers need local Codex digest.");
  if (args.sendEmail) {
    await runEmailStep();
  }
  if (args.push) {
    await commitAndPush();
  }
  process.exit(0);
}

const taskDir = path.join(repoRoot, ".codex-tasks");
await fs.mkdir(taskDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const promptPath = path.join(taskDir, `paper-reader-${stamp}.prompt.md`);
const outputPath = path.join(taskDir, `paper-reader-${stamp}.output.json`);
const prompt = buildHarnessPrompt(selected, {
  projectPath: repoRoot,
  dailyPath,
  outputMode: "json"
});

await fs.writeFile(promptPath, prompt, "utf8");
console.log(`Prepared local Codex prompt for ${selected.length} papers.`);
console.log(`Prompt: ${promptPath}`);

if (args.dryRun) {
  console.log("Dry run: local Codex was not invoked.");
  process.exit(0);
}

const codexBin = await resolveCodexBin(args.codexBin);
const codexArgs = [
  "exec",
  "--cd",
  repoRoot,
  "--sandbox",
  "read-only",
  "--ask-for-approval",
  "never",
  "--output-last-message",
  outputPath
];

if (args.model) {
  codexArgs.push("--model", args.model);
}

codexArgs.push("-");

await runCommand(codexBin, codexArgs, {
  cwd: repoRoot,
  input: prompt,
  env: {
    ...process.env,
    NO_COLOR: "1"
  }
});

const outputText = await fs.readFile(outputPath, "utf8");
const imported = parseCodexDigestOutput(outputText);
const merged = mergeDigestUpdates(digest, imported, dailyPath);
await writeJson(dailyPath, merged.digest);

console.log(`Local Codex digest merged: ${merged.applied} applied, ${merged.failed} failed validation, ${merged.unknown} unknown ids.`);

if (!args.keepOutput) {
  await safeUnlink(promptPath);
  await safeUnlink(outputPath);
}

if (args.sendEmail) {
  await runEmailStep();
}

if (args.push) {
  await commitAndPush();
}

function mergeDigestUpdates(currentDigest, imported, filePath) {
  const now = new Date().toISOString();
  const updates = Array.isArray(imported?.papers) ? imported.papers : Array.isArray(imported) ? imported : [];
  if (updates.length === 0) {
    throw new Error("Local Codex returned no papers array.");
  }

  const updateById = new Map(updates.filter((item) => item?.id).map((item) => [item.id, item]));
  let applied = 0;
  let failed = 0;
  let unknown = 0;

  const knownIds = new Set(papers.map((paper) => paper.id));
  for (const id of updateById.keys()) {
    if (!knownIds.has(id)) {
      unknown += 1;
    }
  }

  const updatedPapers = papers.map((paper) => {
    const update = updateById.get(paper.id);
    if (!update?.digest) {
      return paper;
    }

    const mergedPaper = {
      ...paper,
      digest: sanitizeDigest(update.digest),
      workflow: {
        ...(paper.workflow ?? {}),
        ...(update.workflow ?? {}),
        digestStatus: update.workflow?.digestStatus === "failed" ? "failed" : "ready",
        emailStatus: update.workflow?.digestStatus === "failed" ? "waiting-digest" : "ready",
        harnessVersion: update.workflow?.harnessVersion ?? HARNESS_VERSION,
        harnessCheckedAt: update.workflow?.harnessCheckedAt ?? now,
        digestError: update.workflow?.digestStatus === "failed" ? cleanText(update.workflow?.digestError) : ""
      }
    };
    const validation = update.workflow?.digestStatus === "failed"
      ? {
        id: paper.id,
        title: paper.title,
        issues: [cleanText(update.workflow?.digestError) || "Local Codex marked digestStatus as failed"],
        warnings: []
      }
      : validatePaperHarness(mergedPaper);
    const validated = applyHarnessValidation(mergedPaper, validation, now);
    applied += 1;
    if (validation.issues.length > 0) {
      failed += 1;
    }
    return validated;
  });

  const updatedDigest = {
    ...currentDigest,
    generatedAt: now,
    stats: {
      ...(currentDigest.stats ?? {}),
      ...buildHarnessStats({ ...currentDigest, papers: updatedPapers })
    },
    papers: updatedPapers
  };

  return {
    digest: updatedDigest,
    applied,
    failed,
    unknown,
    filePath
  };
}

function sanitizeDigest(digest) {
  return {
    ...digest,
    tags: Array.isArray(digest.tags) ? digest.tags.map(cleanText).filter(Boolean).slice(0, 8) : [],
    motivationDetail: normalizeObject(digest.motivationDetail),
    methodDetail: {
      ...normalizeObject(digest.methodDetail),
      componentsZh: Array.isArray(digest.methodDetail?.componentsZh)
        ? digest.methodDetail.componentsZh.map(cleanText).filter(Boolean)
        : []
    },
    experimentDetail: {
      ...normalizeObject(digest.experimentDetail),
      metricsZh: Array.isArray(digest.experimentDetail?.metricsZh)
        ? digest.experimentDetail.metricsZh.map(cleanText).filter(Boolean)
        : []
    },
    evidence: {
      ...normalizeObject(digest.evidence),
      usedSources: Array.isArray(digest.evidence?.usedSources)
        ? digest.evidence.usedSources.map(cleanText).filter(Boolean)
        : [],
      missingFields: Array.isArray(digest.evidence?.missingFields)
        ? digest.evidence.missingFields.map(cleanText).filter(Boolean)
        : []
    },
    confidence: normalizeObject(digest.confidence)
  };
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseCodexDigestOutput(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Local Codex output was not valid JSON.");
  }
}

async function runEmailStep() {
  await runCommand(process.execPath, ["scripts/paper-agent.mjs", "--email-only", "--send-email"], { cwd: repoRoot });
}

async function commitAndPush() {
  await runCommand("git", ["add", "public/research-digest/daily.json", "public/research-digest/papers.json"], { cwd: repoRoot });
  const staged = await runCommand("git", ["diff", "--cached", "--quiet"], {
    cwd: repoRoot,
    allowFailure: true,
    silent: true
  });

  if (staged.status === 0) {
    console.log("No digest data changes to commit.");
    return;
  }

  await runCommand("git", ["commit", "-m", "Update local Codex paper digest"], { cwd: repoRoot });
  await runCommand("git", ["push"], { cwd: repoRoot });
}

async function resolveCodexBin(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.PAPER_AGENT_CODEX_BIN,
    process.env.CODEX_BIN,
    DEFAULT_CODEX_BIN,
    "codex"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "codex") {
      return candidate;
    }
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Codex CLI not found. Set PAPER_AGENT_CODEX_BIN to the Codex executable path.");
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: ["pipe", options.silent ? "pipe" : "inherit", options.silent ? "pipe" : "inherit"]
    });

    let stdout = "";
    let stderr = "";
    if (options.silent) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (status) => {
      const result = { status, stdout, stderr };
      if (status === 0 || options.allowFailure) {
        resolve(result);
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${status}`));
      }
    });

    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    // Nothing to clean up.
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseArgs(argv) {
  const parsed = {
    limit: 8,
    all: false,
    dryRun: false,
    sendEmail: false,
    push: false,
    pull: false,
    keepOutput: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    switch (arg) {
      case "--input":
      case "-i":
        parsed.input = next();
        break;
      case "--limit":
      case "-n":
        parsed.limit = Number.parseInt(next(), 10) || 8;
        break;
      case "--id":
        parsed.id = next();
        break;
      case "--model":
        parsed.model = next();
        break;
      case "--codex-bin":
        parsed.codexBin = next();
        break;
      case "--all":
        parsed.all = true;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        parsed.keepOutput = true;
        break;
      case "--send-email":
        parsed.sendEmail = true;
        break;
      case "--no-email":
        parsed.sendEmail = false;
        break;
      case "--push":
        parsed.push = true;
        break;
      case "--pull":
        parsed.pull = true;
        break;
      case "--keep-output":
        parsed.keepOutput = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
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
  npm run codex:digest
  npm run codex:daily
  node scripts/local-codex-digest.mjs --limit 5 --send-email --push

Options:
  --input <path>     Daily digest JSON path.
  --limit <n>        Max papers to send to local Codex. Default: 8.
  --id <paperId>     Process one paper by id.
  --model <model>    Codex model override.
  --codex-bin <path> Codex CLI path.
  --all              Include ready/pushed papers too.
  --dry-run          Write the prompt file but do not invoke Codex.
  --send-email       Send ready papers after merging Codex digests.
  --push             Commit and push daily/history JSON changes.
  --pull             Pull with rebase/autostash before running.
  --keep-output      Keep .codex-tasks prompt/output files.
`);
}
