#!/usr/bin/env node

import {
  applyHarnessValidation,
  buildHarnessStats,
  readJson,
  validatePaperHarness,
  writeJson
} from "./harness-core.mjs";

const args = parseArgs(process.argv.slice(2));
const digestPath = args.input ?? "public/research-digest/daily.json";
const digest = await readJson(digestPath);
const papers = Array.isArray(digest.papers) ? digest.papers : [];
const checkedAt = new Date().toISOString();
const validations = papers
  .filter((paper) => args.all || !paper.pushedAt && !paper.emailSentAt)
  .map(validatePaperHarness);

const failed = validations.filter((item) => item.issues.length > 0);
const warned = validations.filter((item) => item.warnings.length > 0);

printReport(validations, failed, warned);

if (args.write) {
  const validationById = new Map(validations.map((item) => [item.id, item]));
  const updatedPapers = papers.map((paper) => {
    const validation = validationById.get(paper.id);
    return validation ? applyHarnessValidation(paper, validation, checkedAt) : paper;
  });
  const updatedDigest = {
    ...digest,
    generatedAt: checkedAt,
    stats: {
      ...(digest.stats ?? {}),
      ...buildHarnessStats({ ...digest, papers: updatedPapers })
    },
    papers: updatedPapers
  };
  await writeJson(digestPath, updatedDigest);
  console.log(`Updated workflow validation state in ${digestPath}.`);
}

process.exit(failed.length > 0 ? 1 : 0);

function printReport(validations, failed, warned) {
  console.log(`Harness validation: ${validations.length} papers checked, ${failed.length} failed, ${warned.length} with warnings.`);

  for (const item of validations) {
    if (item.issues.length === 0 && item.warnings.length === 0) {
      continue;
    }

    console.log("");
    console.log(`${item.issues.length ? "FAIL" : "WARN"} ${item.id} ${item.title ?? ""}`);
    for (const issue of item.issues) {
      console.log(`  - ${issue}`);
    }
    for (const warning of item.warnings) {
      console.log(`  ~ ${warning}`);
    }
  }
}

function parseArgs(argv) {
  const parsed = {
    all: false,
    write: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    switch (arg) {
      case "--input":
      case "-i":
        parsed.input = next();
        break;
      case "--all":
        parsed.all = true;
        break;
      case "--write":
        parsed.write = true;
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
  npm run harness:validate
  node scripts/validate-digest-harness.mjs --write

Options:
  --input <path>  Daily digest JSON path.
  --all           Validate every paper, including pushed archive entries in daily.json.
  --write         Write workflow.digestStatus and stats back to the digest file.
`);
}
