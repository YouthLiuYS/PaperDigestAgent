#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

await loadEnvFile(path.join(repoRoot, ".env.local"));
await loadEnvFile(path.join(repoRoot, ".env"));

const apiKey = process.env.PAPER_AGENT_AI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const model = process.env.PAPER_AGENT_AI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const apiUrl = normalizeAiApiUrl(process.env.PAPER_AGENT_AI_API_URL ?? process.env.OPENAI_BASE_URL);

if (!apiKey) {
  console.error("AI test failed: missing PAPER_AGENT_AI_API_KEY or OPENAI_API_KEY.");
  process.exit(1);
}

console.log(`AI endpoint: ${apiUrl}`);
console.log(`AI model: ${model}`);

try {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是一个连接测试助手。" },
        { role: "user", content: "请只回复：AI连接成功" }
      ],
      temperature: 0
    })
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(`AI test failed: HTTP ${response.status} ${response.statusText}`);
    console.error(trimForLog(text));
    process.exit(1);
  }

  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content ?? "";
  console.log(`AI test ok: ${content || "received a valid response"}`);
} catch (error) {
  console.error(`AI test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

async function loadEnvFile(filePath) {
  let content;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim().replace(/^[ '\"]|[ '\"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function normalizeAiApiUrl(value) {
  if (!value) {
    return "https://api.openai.com/v1/chat/completions";
  }
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function trimForLog(text) {
  const trimmed = text.trim();
  return trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}...` : trimmed;
}
