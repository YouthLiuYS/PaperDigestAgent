# PaperDigestAgent hosted daily task

This task runs in ChatGPT Work on the web, using the connected GitHub app. It must not depend on a local computer, local Codex CLI, local files, browser sign-ins, or an OpenAI API key.

Repository: `YouthLiuYS/PaperDigestAgent`, default branch `main`.

This is one execution of an existing scheduled task. Execute the paper workflow now. Do not create, reschedule, pause, or update automations, change plugin permissions, or answer merely that a task has been scheduled. Scheduling is managed separately by the owner.

The owner authorizes this recurring task to read this repository and public paper sources, generate evidence-based Chinese digests, and commit only `data/cloud-digest-updates.json` to `main`. That commit starts the trusted GitHub Actions delivery workflow, which validates the digests and uses the owner's existing configured mailbox and recipients. Do not access or copy SMTP credentials. Do not send a second message through Gmail or any other mail account.

## Every run

1. Read this file, `harness/paper-reader-v1.md`, `harness/paper-digest.schema.json`, `scripts/harness-core.mjs`, and `public/research-digest/daily.json` through the GitHub app. Use their actual current contents. Read the existing `data/cloud-digest-updates.json` and retain its current blob SHA for a safe update.
2. Work only on daily papers with neither `pushedAt` nor `emailSentAt` and an incomplete, fallback, pending, or failed digest. Preserve complete digests. If the queue is empty or everything is complete/sent, stop without committing or emailing anything.
   Check `digestDate` against today's date in Asia/Shanghai. If an older queue still has unfinished papers, finish that backlog using its original date. If an older queue is already complete or empty, report that collection is late rather than presenting it as today's successful digest. Read `sourceHealth` when present and report any failed/degraded source while processing available papers. The owner also configured a 10:30 Asia/Shanghai catch-up task using this same workflow; it processes only unfinished work and remains quiet when everything is done.
3. Generate the full digest object required by the schema, not just the five short fields. Motivation, method, and experiments must each be concrete and at least 30 Chinese characters, summary at least 40 characters. Include all detailed evidence and confidence fields and at least three tags. Follow the hardware/architecture-first direction; PIM-only is secondary to PNM, memory hierarchies and LLM accelerators.
4. Use only supplied metadata, abstracts, and sources actually read. Public paper abstracts/PDFs may be consulted through available search or retrieval tools. Never invent affiliations, experiments, baselines, datasets, hardware, speedups, or results. Unknown affiliations are exactly `未在 DBLP/arXiv 元数据中提供`. Explicitly explain missing experiments and source limitations. If the evidence cannot support a rigorous digest, leave that paper out and report its id and reason.
5. Write valid JSON to `data/cloud-digest-updates.json` with this shape, preserving the queue's exact `digestDate`:

   ```json
   {
     "harnessVersion": "paper-reader-v1",
     "digestDate": "date read from daily.json",
     "papers": [
       { "id": "exact original id", "digest": { "all schema-required fields": "..." } }
     ]
   }
   ```

   The placeholder above illustrates the envelope; the saved `digest` must contain the real schema fields and values. Include only ids from the queue and never include delivery flags. Construct the complete JSON before calling any GitHub write tool. The `content` argument must be the entire non-empty UTF-8 JSON string, with at least one real paper and every required digest field. Never clear, initialize, truncate, test-write, or reset this file using an empty string, `null`, `{}`, an empty papers array, a file path, or a placeholder. Parse/validate the constructed JSON with an available cloud code tool when possible; otherwise check its envelope and schema fields explicitly. A lack of eligible papers means no write at all.

   Reread the daily queue immediately before committing and remove any ids that have already been sent or completed by another run. Use GitHub `update_file` on `main`, with the complete contents and the latest blob SHA, and a commit message such as `Prepare cloud Chinese paper digests`. Do not modify `daily.json`, `papers.json`, scripts, workflows, or secrets from this scheduled task. If GitHub rejects a stale SHA, reread the queue and update file and retry at most once. If no supported GitHub write tool is available, report a failure; do not pretend the work was saved. If an approval describes an empty-file write, cancel that invalid operation; do not request or broaden permissions to force it through.
6. GitHub Actions `Deliver Cloud Paper Digest` applies the update only after harness validation, sends unpushed ready papers, then records `emailSentAt` and merges the sent papers into history. Merely writing the update file does not prove email delivery. Reread the queue after a reasonable wait and report actual saved/sent/failed/pending counts. Never claim email succeeded unless the queue has delivery timestamps for the processed ids. Never resubmit completed digests just because delivery is still pending. A fallback delivery run at 09:15 Asia/Shanghai picks up valid pending email work.

The GitHub plugin is configured to automatically review low-risk actions across conversations. The write authorization above covers public paper digest updates in this repository; it does not authorize unrelated repository changes, secrets, or permission changes. If an approval is still requested, report that concrete blocker without creating another schedule.

Only report a meaningful result: a digest commit, delivery confirmation, a validation/source failure, or required user action. When the current day's queue has no eligible work, remain quiet. No local execution and no direct model API calls are part of this workflow.
