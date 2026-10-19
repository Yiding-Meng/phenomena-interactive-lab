// 视觉原语的真浏览器验证：只用新的 renderGridWithProbe / renderPhaseSpaceTrajectory，
// 不改 app.js。启动本地静态服务 -> 无头 Chromium 加载 -> 模拟鼠标 hover -> 截图。
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "artifacts", "audit", "primitives");
await mkdir(outDir, { recursive: true });

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  "/Users/mengyiding/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell";

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: "4182" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk.toString()));
server.stderr.on("data", (chunk) => (serverLog += chunk.toString()));

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4182/");
      if (response.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server did not start:\n${serverLog}`);
}

const browser = await chromium.launch({ executablePath, headless: true });
const report = { checks: [], status: "PASS" };
const errors = [];

function check(name, ok, detail = {}) {
  report.checks.push({ name, ok, ...detail });
  if (!ok) report.status = "FAIL";
}

try {
  await waitForServer();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setContent(`<!doctype html>
    <html lang="zh-CN"><head><meta charset="utf-8" />
    <style>
      html,body { margin:0; background:#0f172a; }
      #stage { width: 1180px; height: 660px; padding: 12px; }
      canvas { display:block; width: 1180px; height: 660px; }
    </style></head>
    <body><div id="stage"><canvas id="c"></canvas></div>
    <script src="http://127.0.0.1:4182/src/simmath.js"></script>
    <script src="http://127.0.0.1:4182/src/domains.js"></script>
    <script src="http://127.0.0.1:4182/src/chart-renderer.js"></script>
    </body></html>`);
  await page.waitForFunction(() => Boolean(window.PhenomenaChart && window.Domains));

  // ---- Grid_Tensor_View ----
  await page.evaluate(() => {
    const result = window.Domains.compute("cnn", {
      kernelSize: 5,
      sigma: 1.1,
      gain: 1.3,
      stride: 1,
    });
    window.__probeResult = result;
    window.PhenomenaChart.renderGridWithProbe(document.querySelector("#c"), result, {
      width: 1180,
      height: 660,
      dpr: 1,
    });
  });
  await page.screenshot({ path: resolve(outDir, "grid-probe-idle.png") });

  const layout = await page.evaluate(() => {
    const canvas = document.querySelector("#c");
    const { panels, band } = canvas.__gridProbe.layout;
    return { panels, band };
  });

  const rect = await page.evaluate(() => {
    const canvas = document.querySelector("#c");
    const box = canvas.getBoundingClientRect();
    return { left: box.left, top: box.top };
  });

  const hoverAt = async (panel, rowRatio, columnRatio, name) => {
    const panelBox = layout.panels[panel];
    const x = rect.left + panelBox.x + panelBox.size * columnRatio;
    const y = rect.top + panelBox.y + panelBox.size * rowRatio;
    await page.mouse.move(x, y);
    await page.waitForTimeout(60);
    const probe = await page.evaluate(() => {
      const canvas = document.querySelector("#c");
      const state = canvas.__gridProbe || {};
      return {
        hover: state.hover || null,
        probe: state.probe
          ? {
              panel: state.probe.panel,
              outputRow: state.probe.outputRow,
              outputColumn: state.probe.outputColumn,
              inputRow: state.probe.inputRow,
              inputColumn: state.probe.inputColumn,
              inputValue: state.probe.inputValue,
              outputValue: state.probe.outputValue,
              preActivation: state.probe.preActivation,
              relu: state.probe.relu,
              finite: state.probe.finite,
            }
          : null,
      };
    });
    await page.screenshot({ path: resolve(outDir, `grid-probe-${name}.png`) });
    return probe;
  };

  const inputProbe = await hoverAt("input", 0.5, 0.42, "input");
  check("输入图 hover 生成 grid 探针", inputProbe.probe?.panel === "grid", inputProbe.probe || {});
  check("输入图探针数值有限", Boolean(inputProbe.probe?.finite), inputProbe.probe || {});

  const activationProbe = await hoverAt("activation", 0.7, 0.3, "activation");
  check("激活图 hover 生成 grid 探针", activationProbe.probe?.panel === "grid", activationProbe.probe || {});
  const matches = await page.evaluate((probe) => {
    const result = window.__probeResult;
    return (
      Math.abs(
        probe.outputValue - result.activation[probe.outputRow][probe.outputColumn],
      ) < 1e-12
    );
  }, activationProbe.probe);
  check("探针输出值等于真实 activation 数组值", matches, activationProbe.probe);

  const kernelProbe = await hoverAt("kernel", 0.5, 0.5, "kernel");
  check("卷积核 hover 生成 kernel 探针", kernelProbe.probe?.panel === "kernel", kernelProbe.probe || {});

  const pixelDiff = await page.evaluate(async () => {
    const canvas = document.querySelector("#c");
    const snapshot = () => {
      const buffer = document.createElement("canvas");
      buffer.width = 320;
      buffer.height = Math.round((320 * canvas.height) / canvas.width);
      const context = buffer.getContext("2d", { willReadFrequently: true });
      context.drawImage(canvas, 0, 0, buffer.width, buffer.height);
      return context.getImageData(0, 0, buffer.width, buffer.height).data;
    };
    const before = snapshot();
    const { panels } = canvas.__gridProbe.layout;
    // 直接派发一次 pointermove 到激活图中心，避免依赖真实鼠标状态
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: canvas.getBoundingClientRect().left + panels.activation.x + 20,
        clientY: canvas.getBoundingClientRect().top + panels.activation.y + 20,
        bubbles: true,
      }),
    );
    const after = snapshot();
    let sum = 0;
    let count = 0;
    for (let index = 0; index < before.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = (before[index + channel] - after[index + channel]) / 255;
        sum += delta * delta;
        count += 1;
      }
    }
    return sum / count;
  });
  check("hover 触发画布重绘（像素差分 > 0）", pixelDiff > 1e-6, { pixelDiff });
  await page.screenshot({ path: resolve(outDir, "grid-probe-after-dispatch.png") });

  // ---- 相空间轨迹 ----
  for (const domainId of ["pendulum", "oscillator"]) {
    for (const presetId of await page.evaluate(
      (id) => window.Domains.getDomain(id).presets.map((preset) => preset.id),
      domainId,
    )) {
      const info = await page.evaluate(
        ([id, preset]) => {
          const domain = window.Domains.getDomain(id);
          const chosen = domain.presets.find((entry) => entry.id === preset);
          const result = window.Domains.compute(id, chosen.params);
          const output = window.PhenomenaChart.renderPhaseSpaceTrajectory(
            document.querySelector("#c"),
            result,
            { width: 1180, height: 620, dpr: 1 },
          );
          return {
            points: output.model.points.length,
            arrows: output.model.arrows.length,
            start: output.model.start,
            end: output.model.end,
            finite: output.model.finite,
            xDomain: output.xDomain,
            yDomain: output.yDomain,
          };
        },
        [domainId, presetId],
      );
      check(
        `${domainId}/${presetId} 相空间轨迹有箭头与起终点`,
        info.arrows >= 2 && Boolean(info.start) && Boolean(info.end) && info.finite,
        info,
      );
      check(
        `${domainId}/${presetId} 相空间坐标轴未坍缩`,
        info.xDomain[1] > info.xDomain[0] && info.yDomain[1] > info.yDomain[0],
        info,
      );
      await page.screenshot({
        path: resolve(outDir, `phase-${domainId}-${presetId}.png`),
      });
    }
  }

  // 极端参数：不能有 NaN，也不能坍缩
  for (const domainId of ["pendulum", "oscillator"]) {
    const extremes = await page.evaluate((id) => {
      const controls = window.Domains.getDomain(id).controls;
      return [
        Object.fromEntries(controls.map((control) => [control.id, control.min])),
        Object.fromEntries(controls.map((control) => [control.id, control.max])),
      ];
    }, domainId);
    extremes.forEach((params, index) => {
      const info = page.evaluate(
        ([id, p]) => {
          const result = window.Domains.compute(id, p);
          const output = window.PhenomenaChart.renderPhaseSpaceTrajectory(
            document.querySelector("#c"),
            result,
            { width: 1180, height: 620, dpr: 1 },
          );
          return {
            finite: output.model.finite,
            xDomain: output.xDomain,
            yDomain: output.yDomain,
          };
        },
        [domainId, params],
      );
      return info.then((value) => {
        check(
          `${domainId} 极端参数 ${index === 0 ? "min" : "max"} 相空间仍有效`,
          value.finite && value.xDomain[1] > value.xDomain[0] && value.yDomain[1] > value.yDomain[0],
          value,
        );
      });
    });
    await Promise.all(extremes);
  }

  // ---- 既有 API 兼容性 ----
  const compat = await page.evaluate(() => {
    const canvas = document.querySelector("#c");
    const pendulum = window.Domains.compute("pendulum", {});
    const cnn = window.Domains.compute("cnn", {});
    const pulse = window.Domains.compute("pulse", {});
    const portrait = window.PhenomenaChart.renderPhasePortrait(canvas, pendulum, {
      width: 1180,
      height: 620,
      dpr: 1,
    });
    const triptych = window.PhenomenaChart.renderTriptych(canvas, cnn, {
      width: 1180,
      height: 620,
      dpr: 1,
    });
    const plot = window.PhenomenaChart.renderPlot(canvas, {
      width: 1180,
      height: 620,
      dpr: 1,
      series: [{ values: pulse.series.current, color: "#7cf7d4" }],
      xDomain: pulse.axes.xRange,
      yDomain: pulse.axes.yRange,
    });
    return {
      portrait: Boolean(portrait?.bounds),
      triptych: Boolean(triptych?.width),
      plot: Boolean(plot?.bounds),
    };
  });
  check(
    "既有 renderPhasePortrait / renderTriptych / renderPlot 仍可用",
    compat.portrait && compat.triptych && compat.plot,
    compat,
  );

  check("浏览器控制台无错误", errors.length === 0, { errors });
} catch (error) {
  report.status = "FAIL";
  report.error = String(error?.stack || error);
} finally {
  await browser.close();
  server.kill("SIGTERM");
}

report.consoleErrors = errors;
await writeFile(
  resolve(outDir, "report.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
console.log(`PRIMITIVES CHECK: ${report.status}`);
for (const item of report.checks) {
  console.log(`  ${item.ok ? "PASS" : "FAIL"}  ${item.name}`);
}
if (report.error) console.error(report.error);
process.exit(report.status === "PASS" ? 0 : 1);
