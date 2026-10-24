import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { repoRoot } from "../scripts/harness-core.mjs";
import { validPaper } from "./paper-fixture.mjs";

async function runDelivery(t, closeBeforeData) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "paper-smtp-test-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const server = net.createServer((socket) => {
    socket.on("error", () => {});
    socket.write("220 test SMTP\r\n");
    let buffer = "";
    let inData = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (inData) {
        if (buffer.includes("\r\n.\r\n")) socket.end("250 accepted\r\n");
        return;
      }
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line.startsWith("MAIL") && closeBeforeData) {
          socket.destroy();
          return;
        }
        if (line === "DATA") {
          inData = true;
          socket.write("354 send message\r\n");
          return;
        }
        socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const dailyPath = path.join(temp, "daily.json");
  const historyPath = path.join(temp, "history.json");
  const configPath = path.join(temp, "config.json");
  await fs.writeFile(dailyPath, JSON.stringify({ digestDate: "2026-10-24", papers: [validPaper()] }));
  await fs.writeFile(historyPath, JSON.stringify({ papers: [] }));
  await fs.writeFile(configPath, JSON.stringify({ email: {
    enabled: true, host: "127.0.0.1", port: server.address().port, secure: false,
    starttls: false, user: "", pass: "", from: "test@example.invalid", to: ["recipient@example.invalid"]
  } }));
  const child = spawn(process.execPath, ["scripts/paper-agent.mjs", "--email-only", "--send-email",
    "--config", configPath, "--output", historyPath, "--daily-output", dailyPath], {
    cwd: repoRoot, env: { ...process.env, TZ: "Asia/Shanghai" }, stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  const code = await new Promise((resolve) => child.once("exit", resolve));
  clearTimeout(timer);
  return { code, output, daily: JSON.parse(await fs.readFile(dailyPath)), history: JSON.parse(await fs.readFile(historyPath)) };
}

test("records a DATA acknowledgement even if the SMTP peer closes without replying to QUIT", async (t) => {
  const result = await runDelivery(t, false);
  assert.equal(result.code, 0, result.output);
  assert.ok(result.daily.papers[0].emailSentAt);
  assert.equal(result.history.papers.length, 1);
  assert.doesNotMatch(result.output, /recipient@example\.invalid/);
});

test("a disconnect before message acceptance fails without marking or archiving delivery", async (t) => {
  const result = await runDelivery(t, true);
  assert.equal(result.code, 1, result.output);
  assert.equal(result.daily.papers[0].emailSentAt, undefined);
  assert.equal(result.history.papers.length, 0);
  assert.match(result.output, /SMTP connection closed/);
});

test("daily collection preserves an earlier unfinished queue without collecting or sending in the test", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "paper-rollover-test-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const dailyPath = path.join(temp, "daily.json");
  const historyPath = path.join(temp, "history.json");
  const configPath = path.join(temp, "config.json");
  await fs.writeFile(dailyPath, JSON.stringify({ digestDate: "2026-10-23", papers: [
    validPaper("unfinished"), { ...validPaper("already-sent"), emailSentAt: "sent-yesterday" }
  ] }));
  const originalHistory = JSON.stringify({ papers: [] });
  await fs.writeFile(historyPath, originalHistory);
  await fs.writeFile(configPath, JSON.stringify({ collectionMode: "daily", arxivQueries: [],
    dblpQueries: [], backfillEnabled: false, email: { enabled: false } }));
  const child = spawn(process.execPath, ["scripts/paper-agent.mjs", "--no-ai", "--no-email",
    "--no-backfill", "--digest-date", "2026-10-24", "--config", configPath,
    "--output", historyPath, "--daily-output", dailyPath], { cwd: repoRoot });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  const code = await new Promise((resolve) => child.once("exit", resolve));
  clearTimeout(timer);
  assert.equal(code, 0, output);
  const daily = JSON.parse(await fs.readFile(dailyPath));
  assert.equal(daily.digestDate, "2026-10-24");
  assert.deepEqual(daily.papers.map((paper) => paper.id), ["unfinished"]);
  assert.equal(await fs.readFile(historyPath, "utf8"), originalHistory);
});
