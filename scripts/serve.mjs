#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "public");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const host = process.env.HOST ?? "127.0.0.1";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

  if (request.method === "POST" && url.pathname === "/api/digest") {
    await saveDigest(request, response, "papers.json");
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/daily-digest") {
    await saveDigest(request, response, "daily.json");
    return;
  }

  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(root, relativePath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    const finalPath = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const body = await fs.readFile(finalPath);
    const type = mimeTypes.get(path.extname(finalPath)) ?? "application/octet-stream";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Paper Digest Agent site: http://${host}:${port}/`);
});

async function saveDigest(request, response, fileName) {
  try {
    const body = await readRequestBody(request, 4 * 1024 * 1024);
    const digest = JSON.parse(body);

    if (!digest || !Array.isArray(digest.papers)) {
      throw new Error("Digest must contain a papers array.");
    }

    const targetPath = path.join(root, "research-digest", fileName);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, `${JSON.stringify({ ...digest, generatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");

    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ ok: true }));
  } catch (error) {
    response.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}

function readRequestBody(request, limit) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
