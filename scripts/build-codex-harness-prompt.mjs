#!/usr/bin/env node

import {
  buildHarnessPrompt,
  needsHarnessDigest,
  readJson,
  repoRoot
} from "./harness-core.mjs";

const args = parseArgs(process.argv.slice(2));
const digestPath = args.input ?? "public/research-digest/daily.json";
const digest = await readJson(digestPath);
const papers = Array.isArray(digest.papers) ? digest.papers : [];
const selected = papers
  .filter((paper) => args.all || needsHarnessDigest(paper))
  .filter((paper) => !args.id || paper.id === args.id)
  .slice(0, args.limit);

if (selected.length === 0) {
  console.log("No papers need harness digest.");
  process.exit(0);
}

console.log(buildHarnessPrompt(selected, {
  projectPath: repoRoot,
  dailyPath: digestPath
}));

function parseArgs(argv) {
  const parsed = {
    limit: 10,
    all: false
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
        parsed.limit = Number.parseInt(next(), 10) || 10;
        break;
      case "--id":
        parsed.id = next();
        break;
      case "--all":
        parsed.all = true;
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
  npm run harness:prompt
  node scripts/build-codex-harness-prompt.mjs --limit 5
  node scripts/build-codex-harness-prompt.mjs --id arxiv:2501.12345

Options:
  --input <path>  Daily digest JSON path.
  --limit <n>     Max papers to include. Default: 10.
  --id <paperId>  Include one paper by id.
  --all           Include pushed/ready papers too.
`);
}
