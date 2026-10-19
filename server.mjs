import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import generationService from "./src/generation-service.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const maxBodyBytes = 64 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]).replaceAll("\\", "/");
  const requested = clean === "/" ? "/index.html" : clean;
  const absolute = normalize(join(root, requested));
  if (absolute !== root && !absolute.startsWith(root + sep)) return null;
  return absolute;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("请求体过大。");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求体不是合法 JSON。");
    error.status = 400;
    throw error;
  }
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/status") {
    sendJson(response, 200, generationService.dynamicStatus());
    return true;
  }
  if (request.method === "GET" && pathname === "/api/examples") {
    sendJson(response, 200, {
      examples: generationService.dynamicStatus().examples,
    });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/generate") {
    try {
      const body = await readJsonBody(request);
      const result = await generationService.generateBlueprint({
        text: body.concept,
      });
      sendJson(response, 200, {
        status: "ok",
        ...result,
      });
    } catch (error) {
      const payload = generationService.generationErrorPayload(error);
      sendJson(response, error.status || payload.status, payload);
    }
    return true;
  }
  if (pathname.startsWith("/api/")) {
    sendJson(response, 404, {
      status: "error",
      code: "NOT_FOUND",
      message: "API route not found.",
    });
    return true;
  }
  return false;
}

const server = createServer(async (request, response) => {
  const pathname = (request.url || "/").split("?")[0];
  if (await handleApi(request, response, pathname)) return;
  const filePath = safePath(request.url || "/");
  if (!filePath) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Phenomena running at http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
