import assert from "node:assert/strict";
import test from "node:test";
import { mergeCloudDigests, readyPapersForCloudEmail } from "../scripts/cloud-digest.mjs";
import { validPaper } from "./paper-fixture.mjs";

const date = "2026-10-24";
const pending = (id) => ({ id, title: `Test ${id}`, source: "arXiv", abstract: "Test abstract",
  digest: { summaryZh: "AI 摘要未生成" }, workflow: { digestStatus: "pending" } });
const updates = (papers) => ({ harnessVersion: "paper-reader-v1", digestDate: date, papers });

test("imports validated digests while preserving source metadata and unrelated papers", () => {
  const a = pending("a");
  const b = { ...validPaper("b"), pushedAt: "already-sent" };
  const daily = { digestDate: date, papers: [a, b], stats: { collected: 2 } };
  const result = mergeCloudDigests(daily, updates([
    { id: "a", digest: validPaper("a").digest, pushedAt: "untrusted", title: "untrusted" }
  ]), "checked-now");
  assert.equal(result.applied, 1);
  assert.equal(result.digest.papers[0].title, a.title);
  assert.equal(result.digest.papers[0].pushedAt, undefined);
  assert.equal(result.digest.papers[0].workflow.digestStatus, "ready");
  assert.equal(result.digest.papers[1], b);
  assert.equal(result.digest.stats.collected, 2);
  assert.equal(result.digest.stats.pendingEmail, 1);
  assert.equal(result.digest.stats.pushed, 1);
  assert.equal(a.digest.summaryZh, "AI 摘要未生成");
});

test("a rejected digest cannot partially mutate the queue", () => {
  const daily = { digestDate: date, papers: [pending("a"), pending("b")] };
  const before = JSON.stringify(daily);
  assert.throws(() => mergeCloudDigests(daily, updates([
    { id: "a", digest: validPaper("a").digest },
    { id: "b", digest: { summaryZh: "too short" } }
  ])), /b:/);
  assert.equal(JSON.stringify(daily), before);
});

test("refuses unknown ids and duplicate ids on the current queue", () => {
  const daily = { digestDate: date, papers: [pending("a")] };
  assert.throws(() => mergeCloudDigests(daily, updates([{ id: "unknown" }])), /unknown paper/);
  const update = { id: "a", digest: validPaper("a").digest };
  assert.throws(() => mergeCloudDigests(daily, updates([update, update])), /repeated/);
});

test("ignores previous-day updates and replays without rewriting completed or sent papers", () => {
  const daily = { digestDate: date, papers: [validPaper("a"), { ...validPaper("b"), emailSentAt: "sent" }] };
  const stale = { ...updates([{ id: "unknown" }]), digestDate: "2026-10-23" };
  assert.equal(mergeCloudDigests(daily, stale).digest, daily);
  const replay = mergeCloudDigests(daily, updates([{ id: "a" }, { id: "b" }]));
  assert.equal(replay.digest, daily);
  assert.equal(replay.applied, 0);
  assert.equal(replay.skipped, 2);
});

test("email gate checks harness content and sent history instead of trusting ready status", () => {
  assert.throws(() => readyPapersForCloudEmail({ papers: [
    { ...pending("a"), workflow: { digestStatus: "ready" } }
  ] }), /invalid ready digest/);
  assert.throws(() => readyPapersForCloudEmail({ papers: [validPaper("a")] }, {
    papers: [{ id: "a", emailSentAt: "previous delivery" }]
  }), /already present in sent history/);
  assert.equal(readyPapersForCloudEmail({ papers: [pending("a"), validPaper("b")] }).length, 1);
});
