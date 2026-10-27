import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DBLP_ENDPOINT } from "./dblp-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exhaustive = process.argv.includes("--all");
const configured = JSON.parse(await fs.readFile(path.join(root, "public/research-digest/daily.json"), "utf8"));
const queries = exhaustive ? configured.sources?.dblpQueries : ["LLM accelerator"];
if (!Array.isArray(queries) || queries.length === 0) throw new Error("No production DBLP queries were found for validation.");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "paper-dblp-check-"));
try {
  const configPath = path.join(scratch, "config.json");
  const dailyPath = path.join(scratch, "daily.json");
  console.log(`Checking ${queries.length} DBLP query/queries using the production collector in an isolated temporary queue.`);
  await fs.writeFile(configPath, JSON.stringify({ arxivQueries: [], dblpQueries: queries,
    backfillEnabled: false, maxPerQuery: exhaustive ? 8 : 3, dailyMaxPapers: exhaustive ? 8 : 3, minNewPapers: 1 }));
  const { stdout } = await new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ["scripts/paper-agent.mjs",
      "--config", configPath, "--mode", "daily", "--no-ai", "--no-email",
      "--daily-output", dailyPath, "--output", path.join(scratch, "history.json")], {
      cwd: root, timeout: exhaustive ? 480_000 : 120_000, maxBuffer: 1_000_000
    }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  });
  const daily = JSON.parse(await fs.readFile(dailyPath, "utf8"));
  const records = daily.papers;
  if (daily.sourceHealth?.dblp?.status !== "healthy" || daily.sourceHealth.dblp.successfulQueries !== queries.length || records.length === 0
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
