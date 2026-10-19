import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildStandaloneHtml } from "../src/standalone-builder.js";
import Domains from "../src/domains.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const root = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(root, "..", "artifacts", "exports");
await mkdir(outputDir, { recursive: true });

for (const summary of Domains.listDomains()) {
  const domain = Domains.getDomain(summary.id);
  const html = await buildStandaloneHtml({
    domainId: domain.id,
    params: Domains.defaultParams(domain),
  });
  const target = resolve(outputDir, `${domain.id}.html`);
  await writeFile(target, html);
  const selfContained =
    !/<script[^>]+src=/i.test(html) &&
    !/<link[^>]+href=/i.test(html) &&
    html.includes("const api = factory(SimMath)") &&
    html.includes("SimMath");
  if (!selfContained) {
    throw new Error(`${domain.id}: exported HTML still contains external assets`);
  }
  console.log(
    `${domain.id}: ${Buffer.byteLength(html)} bytes, self-contained -> ${target}`,
  );
}

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  "/Users/mengyiding/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell";

let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  for (const summary of Domains.listDomains()) {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 850 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(
      `file://${resolve(outputDir, `${summary.id}.html`)}`,
      { waitUntil: "load" },
    );
    await page.waitForFunction(
      () => window.__SIM_CONTROLLER__ && window.__SIM_CONTROLLER__.getStateMetrics(),
    );
    const domain = Domains.getDomain(summary.id);
    const spec = domain.controls[0];
    const previous = await page.evaluate(() =>
      window.__SIM_CONTROLLER__.getStateMetrics(),
    );
    const changed = await page.evaluate(
      ({ key, value }) => window.__SIM_CONTROLLER__.setParams({ [key]: value }),
      { key: spec.id, value: spec.max },
    );
    if (!changed.seriesFinite || changed.hasNaN || errors.length) {
      throw new Error(
        `${summary.id}: offline HTML failed (${errors.join("; ") || "non-finite"})`,
      );
    }
    if (previous.params[spec.id] === changed.params[spec.id]) {
      throw new Error(`${summary.id}: exported control did not move`);
    }
    console.log(`${summary.id}: offline browser PASS`);
    await page.close();
  }
} finally {
  await browser?.close();
}
