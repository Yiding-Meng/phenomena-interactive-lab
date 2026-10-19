import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import compilerModule from "../src/blueprint-compiler.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const { compileBlueprint } = compilerModule;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = resolve(root, "artifacts", "audit");
await mkdir(screenshotDir, { recursive: true });

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  "/Users/mengyiding/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: "4181" },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4181/");
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(`Server did not start:\n${serverLog}`);
}

const dynamicFixture = {
  id: "audit_dynamic",
  concept_title: "RC 指数衰减",
  short_name: "RC / TRANSIENT",
  subtitle: "时间常数与放电速率",
  question: "改变时间常数时，电压衰减速度如何变化？",
  pedagogical_goal: "用真实指数衰减比较参考状态与当前状态。",
  mathematical_model: {
    governing_equations_latex: ["V(t)=V_0e^{-t/RC}"],
    numerical_algorithm: "逐点计算指数衰减并检查边界有限性。",
    pipeline: [
      {
        id: "voltage",
        kind: "series",
        label: "电压",
        unit: "V",
        expression: "exp(-t / tau)",
        sampleCount: 160,
        xMin: 0,
        xMax: 10,
      },
    ],
  },
  interactive_controls: [
    {
      id: "tau",
      label: "时间常数",
      symbol: "tau",
      unit: "s",
      min: 0.1,
      max: 5,
      step: 0.1,
      default: 1,
      physical_effect: "增大时间常数会减慢电压衰减。",
    },
  ],
  aha_presets: [
    {
      id: "fast",
      name: "快速放电",
      description: "较小时时间常数。",
      param_values: { tau: 0.3 },
    },
    {
      id: "slow",
      name: "慢速放电",
      description: "较大时间常数。",
      param_values: { tau: 4.2 },
    },
  ],
  visual_views: [{ type: "2D_Plot", x_axis: "时间", y_axis: "电压" }],
};

compileBlueprint(dynamicFixture, { index: "DYN" });

const browser = await chromium.launch({
  executablePath,
  headless: true,
});

try {
  await waitForServer();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("http://127.0.0.1:4181/", {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => window.__APP_READY__ === true);
  await page.screenshot({
    path: resolve(screenshotDir, "overview.png"),
    fullPage: true,
  });

  // Dynamic pipeline: bypass the external model with a deterministic JSON fixture,
  // then exercise the same compile → register → slider → export path as /api/generate.
  await page.evaluate((blueprint) => {
    window.__SIM_CONTROLLER__.registerBlueprint(blueprint);
  }, dynamicFixture);
  await page.waitForFunction(
    () => window.__SIM_CONTROLLER__.getDomain() === "audit_dynamic",
  );
  const dynamicBefore = await page.evaluate(() => {
    window.__SIM_CONTROLLER__.setParams({ tau: 0.2 });
    const canvas = document.querySelector("[data-secondary-canvas]");
    return {
      state: window.__SIM_CONTROLLER__.getStateMetrics(),
      primary: Array.from(window.__SIM_CONTROLLER__.snapshotPixels()),
      secondary: Array.from(window.__SIM_CONTROLLER__.snapshotSecondaryPixels()),
      secondaryBox: {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        display: getComputedStyle(canvas).display,
      },
    };
  });
  const dynamicAfter = await page.evaluate(() => {
    window.__SIM_CONTROLLER__.setParams({ tau: 4.8 });
    const canvas = document.querySelector("[data-secondary-canvas]");
    return {
      state: window.__SIM_CONTROLLER__.getStateMetrics(),
      primary: Array.from(window.__SIM_CONTROLLER__.snapshotPixels()),
      secondary: Array.from(window.__SIM_CONTROLLER__.snapshotSecondaryPixels()),
      secondaryBox: {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        display: getComputedStyle(canvas).display,
      },
    };
  });
  const dynamicSecondaryMse = await page.evaluate(
    ([a, b]) => window.__SIM_CONTROLLER__.comparePixels(a, b),
    [dynamicBefore.secondary, dynamicAfter.secondary],
  );
  const dynamicPrimaryMse = await page.evaluate(
    ([a, b]) => window.__SIM_CONTROLLER__.comparePixels(a, b),
    [dynamicBefore.primary, dynamicAfter.primary],
  );
  const dynamicFixturePass =
    dynamicBefore.state.seriesFinite &&
    dynamicAfter.state.seriesFinite &&
    dynamicBefore.state.trace !== dynamicAfter.state.trace &&
    dynamicPrimaryMse > 0.00002 &&
    dynamicSecondaryMse > 0.00002;
  await page.screenshot({
    path: resolve(screenshotDir, "dynamic-fixture.png"),
    fullPage: false,
  });
  const dynamicExportPage = await browser.newPage({
    viewport: { width: 1100, height: 900 },
    deviceScaleFactor: 1,
  });
  const dynamicExportErrors = [];
  dynamicExportPage.on("pageerror", (error) =>
    dynamicExportErrors.push(error.message),
  );
  dynamicExportPage.on("console", (message) => {
    if (message.type() === "error") dynamicExportErrors.push(message.text());
  });
  const dynamicHtml = await page.evaluate(async () => {
    return window.__SIM_CONTROLLER__.buildStandaloneHtml({ tau: 4.2 });
  });
  await dynamicExportPage.goto(
    `data:text/html;charset=utf-8,${encodeURIComponent(dynamicHtml)}`,
    { waitUntil: "load" },
  );
  await dynamicExportPage.waitForFunction(
    () => window.__SIM_CONTROLLER__ && window.__SIM_CONTROLLER__.getStateMetrics(),
  );
  const dynamicExportBefore = await dynamicExportPage.evaluate(() =>
    window.__SIM_CONTROLLER__.getStateMetrics(),
  );
  const dynamicExportAfter = await dynamicExportPage.evaluate(() =>
    window.__SIM_CONTROLLER__.setParams({ tau: 0.2 }),
  );
  const dynamicExportPass =
    dynamicExportBefore.seriesFinite &&
    dynamicExportAfter.seriesFinite &&
    dynamicExportBefore.trace !== dynamicExportAfter.trace &&
    dynamicExportErrors.length === 0;
  await dynamicExportPage.screenshot({
    path: resolve(screenshotDir, "dynamic-export.png"),
    fullPage: false,
  });
  await dynamicExportPage.close();

  const domainReports = [];
  const domains = ["pulse", "oscillator", "cnn", "pendulum"];
  for (const domainId of domains) {
    await page.evaluate((id) => window.__SIM_CONTROLLER__.setDomain(id), domainId);
    const controls = await page.evaluate(() =>
      window.__SIM_CONTROLLER__.getControls(),
    );
    const presets = await page.evaluate(() =>
      JSON.parse(JSON.stringify(window.Domains.getDomain(window.__SIM_CONTROLLER__.getDomain()).presets)),
    );
    const min = Object.fromEntries(
      controls.map((control) => [control.id, control.min]),
    );
    const max = Object.fromEntries(
      controls.map((control) => [control.id, control.max]),
    );
    const capture = async (name, params) => {
      const metrics = await page.evaluate(
        (payload) => window.__SIM_CONTROLLER__.setParams(payload),
        params,
      );
      await page.screenshot({
        path: resolve(screenshotDir, `${domainId}-${name}.png`),
        fullPage: false,
      });
      return metrics;
    };

    const initialMetrics = await page.evaluate(() =>
      window.__SIM_CONTROLLER__.getStateMetrics(),
    );
    const initialParams = initialMetrics.params;
    const initialPreset = initialMetrics.presetId;
    const defaultMetrics = await capture("default", initialParams);
    const minMetrics = await capture("min", min);
    const maxMetrics = await capture("max", max);
    const presetMetrics = [];
    for (const preset of presets) {
      presetMetrics.push(await capture(`preset-${preset.id}`, preset.params));
    }
    const snapshots = await page.evaluate(
      ([minParams, maxParams, initialValues]) => {
        const capture = (params) => {
          window.__SIM_CONTROLLER__.setParams(params);
          return {
            metrics: window.__SIM_CONTROLLER__.getStateMetrics(),
            pixels: Array.from(window.__SIM_CONTROLLER__.snapshotPixels()),
          };
        };
        return {
          default: capture(initialValues),
          min: capture(minParams),
          max: capture(maxParams),
        };
      },
      [min, max, initialParams],
    );
    const minMaxMse = await page.evaluate(
      ([a, b]) => window.__SIM_CONTROLLER__.comparePixels(a, b),
      [snapshots.min.pixels, snapshots.max.pixels],
    );
    const minDefaultMse = await page.evaluate(
      ([a, b]) => window.__SIM_CONTROLLER__.comparePixels(a, b),
      [snapshots.default.pixels, snapshots.min.pixels],
    );
    const defaultMaxMse = await page.evaluate(
      ([a, b]) => window.__SIM_CONTROLLER__.comparePixels(a, b),
      [snapshots.default.pixels, snapshots.max.pixels],
    );

    const allSnapshots = [defaultMetrics, minMetrics, maxMetrics, ...presetMetrics];
    const finite = allSnapshots.every(
      (snapshot) => snapshot.seriesFinite && !snapshot.hasNaN,
    );
    const controlsMoved = (await page.evaluate(
      () => window.__SIM_CONTROLLER__.getControls(),
    )).every((control) => control.min !== control.max);
    const initialPresetMatches = presets.some(
      (preset) =>
        preset.id === initialPreset &&
        controls.every(
          (control) =>
            Math.abs(
              preset.params[control.id] - initialParams[control.id],
            ) < 1e-9,
        ),
    );
    const visualDiff = Math.max(minDefaultMse, defaultMaxMse, minMaxMse) > 0.00002;
    const status =
      finite && controlsMoved && initialPresetMatches && visualDiff
        ? "PASS"
        : "FAIL";
    domainReports.push({
      domainId,
      status,
      finite,
      visualDiff,
      initialPresetMatches,
      minDefaultMse,
      defaultMaxMse,
      minMaxMse,
      controlsTested: controls.length,
      testedScreenshots: 3 + presets.length,
      initialParams,
      initialPreset,
      metrics: allSnapshots.map((snapshot) => snapshot.metrics),
    });
    await page.evaluate(
      ({ params, presetId }) =>
        presetId
          ? window.__SIM_CONTROLLER__.setPreset(presetId)
          : window.__SIM_CONTROLLER__.setParams(params),
      { params: initialParams, presetId: initialPreset },
    );
  }

  await page.evaluate(() => window.__SIM_CONTROLLER__.setDomain("pulse"));
  await page.evaluate(() => window.__SIM_CONTROLLER__.openAuditPanel());
  await page.waitForFunction(
    () => window.__SIM_CONTROLLER__.lastAuditReport !== undefined,
  );
  const uiAudit = await page.evaluate(() => window.__SIM_CONTROLLER__.lastAuditReport);
  await page.screenshot({
    path: resolve(screenshotDir, "audit-panel.png"),
    fullPage: false,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__APP_READY__ === true);
  await page.screenshot({
    path: resolve(screenshotDir, "mobile.png"),
    fullPage: true,
  });

  const exportedPages = [];
  for (const domainId of domains) {
    const exportedPath = resolve(root, "artifacts", "exports", `${domainId}.html`);
    const exportPage = await browser.newPage({
      viewport: { width: 1100, height: 900 },
      deviceScaleFactor: 1,
    });
    const exportErrors = [];
    exportPage.on("pageerror", (error) => exportErrors.push(error.message));
    exportPage.on("console", (message) => {
      if (message.type() === "error") exportErrors.push(message.text());
    });
    await exportPage.goto(`file://${exportedPath}`, { waitUntil: "load" });
    await exportPage.waitForFunction(
      () => window.__SIM_CONTROLLER__ && window.__SIM_CONTROLLER__.getStateMetrics(),
    );
    const before = await exportPage.evaluate(() =>
      window.__SIM_CONTROLLER__.getStateMetrics(),
    );
    const controls = await exportPage.evaluate(() =>
      window.__SIM_CONTROLLER__.getStateMetrics().params,
    );
    const firstKey = Object.keys(controls)[0];
    const controlSpec = await exportPage.evaluate(
      () => window.Domains.getDomain(window.__SIM_CONTROLLER__.getStateMetrics().domain).controls[0],
    );
    const changed = await exportPage.evaluate(
      ({ key, value }) => window.__SIM_CONTROLLER__.setParams({ [key]: value }),
      { key: firstKey, value: controlSpec.max },
    );
    await exportPage.screenshot({
      path: resolve(screenshotDir, `export-${domainId}.png`),
      fullPage: false,
    });
    exportedPages.push({
      domainId,
      finite: changed.seriesFinite && !changed.hasNaN,
      interactive: before.params[firstKey] !== changed.params[firstKey],
      errors: exportErrors,
    });
    await exportPage.close();
  }

  const exportedPass = exportedPages.every(
    (item) => item.finite && item.interactive && item.errors.length === 0,
  );
  const report = {
    generatedAt: new Date().toISOString(),
    status: domainReports.every((item) => item.status === "PASS") &&
      uiAudit.status === "PASS" &&
      dynamicFixturePass &&
      dynamicExportPass &&
      exportedPass
      ? "PASS"
      : "FAIL",
    consoleErrors,
    pageErrors,
    uiAudit,
    dynamicFixture: {
      pass: dynamicFixturePass,
      beforeTrace: dynamicBefore.state.trace,
      afterTrace: dynamicAfter.state.trace,
      secondaryMse: dynamicSecondaryMse,
      primaryMse: dynamicPrimaryMse,
      beforeFinite: dynamicBefore.state.seriesFinite,
      afterFinite: dynamicAfter.state.seriesFinite,
      beforeSecondaryBox: dynamicBefore.secondaryBox,
      afterSecondaryBox: dynamicAfter.secondaryBox,
    },
    dynamicExport: {
      pass: dynamicExportPass,
      beforeTrace: dynamicExportBefore.trace,
      afterTrace: dynamicExportAfter.trace,
      errors: dynamicExportErrors,
    },
    domains: domainReports,
    exportedPages,
  };
  await writeFile(
    resolve(screenshotDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  if (
    report.status !== "PASS" ||
    consoleErrors.length ||
    pageErrors.length ||
    !exportedPass ||
    !dynamicFixturePass ||
    !dynamicExportPass
  ) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
