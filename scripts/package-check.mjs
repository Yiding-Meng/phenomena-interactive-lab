import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const releaseRoot = resolve(root, "artifacts", "release");
const staging = resolve(releaseRoot, "phenomena");
const exclusions = new Set([
  "node_modules",
  "playwright-core",
  "__MACOSX",
  ".git",
  "artifacts",
]);
const junkPattern = /^(\._|\.DS_Store)/;

async function copyTree(source, target) {
  const entries = await readdir(source, { withFileTypes: true });
  await mkdir(target, { recursive: true });
  for (const entry of entries) {
    if (exclusions.has(entry.name) || junkPattern.test(entry.name)) continue;
    const from = resolve(source, entry.name);
    const to = resolve(target, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to);
    } else if (entry.isFile()) {
      await cp(from, to);
    }
  }
}

async function containsJunk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (junkPattern.test(entry.name) || entry.name === "__MACOSX") return true;
    if (entry.isDirectory() && (await containsJunk(resolve(directory, entry.name)))) {
      return true;
    }
  }
  return false;
}

await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await copyTree(root, staging);

const required = [
  "index.html",
  "server.mjs",
  "package.json",
  "src/simmath.js",
  "src/blueprint-compiler.js",
  "src/generation-service.js",
  "src/llm-provider.js",
  "examples/golden/index.js",
  "vendor/katex/katex.min.js",
];
for (const path of required) {
  await stat(resolve(staging, path));
}
if (await containsJunk(staging)) {
  throw new Error("Release package still contains macOS junk files.");
}
const packagedEntries = await readdir(staging);
if (packagedEntries.includes("playwright-core")) {
  throw new Error("playwright-core must remain a dev dependency.");
}

const archive = resolve(releaseRoot, "phenomena-release.zip");
await rm(archive, { force: true });
await new Promise((resolvePromise, reject) => {
  const child = spawn(
    "zip",
    ["-qr", archive, "phenomena", "-x", "*__MACOSX*", "*.DS_Store", "*.zip"],
    { cwd: releaseRoot, stdio: "inherit" },
  );
  child.on("error", reject);
  child.on("close", (code) =>
    code === 0 ? resolvePromise() : reject(new Error(`zip exited ${code}`)),
  );
});
await writeFile(
  resolve(releaseRoot, "manifest.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      archive,
      includesPlaywright: false,
      entries: packagedEntries,
    },
    null,
    2,
  )}\n`,
);
console.log(`clean package -> ${archive}`);
