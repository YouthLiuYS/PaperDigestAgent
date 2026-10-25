import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DBLP_ENDPOINT } from "./dblp-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "paper-dblp-check-"));
try {
  const configPath = path.join(scratch, "config.json");
  const dailyPath = path.join(scratch, "daily.json");
  await fs.writeFile(configPath, JSON.stringify({ arxivQueries: [], dblpQueries: ["LLM accelerator"],
    backfillEnabled: false, maxPerQuery: 3, dailyMaxPapers: 3, minNewPapers: 1 }));
  const { stdout } = await promisify(execFile)(process.execPath, ["scripts/paper-agent.mjs",
    "--config", configPath, "--mode", "daily", "--no-ai", "--no-email",
    "--daily-output", dailyPath, "--output", path.join(scratch, "history.json")], {
    cwd: root, timeout: 120_000, maxBuffer: 1_000_000
  });
  const daily = JSON.parse(await fs.readFile(dailyPath, "utf8"));
  const records = daily.papers;
  if (daily.sourceHealth?.dblp?.status !== "healthy" || records.length === 0
    || records.some((paper) => paper.source !== "DBLP" || !paper.id || !paper.title
      || !paper.authors?.length || paper.emailSentAt || paper.pushedAt)) {
    throw new Error(`The live DBLP collection did not return complete unsent metadata.\n${stdout}`);
  }
  console.log(JSON.stringify({ endpoint: DBLP_ENDPOINT, health: daily.sourceHealth.dblp,
    collected: records.length, records: records.map((paper) => ({ id: paper.id, title: paper.title,
      venue: paper.venue, authors: paper.authors.length, url: paper.url })) }, null, 2));
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
