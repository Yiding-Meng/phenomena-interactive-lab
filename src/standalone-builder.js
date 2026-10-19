(function (root) {
  "use strict";

  const assetPaths = {
    simmath: "src/simmath.js",
    domains: "src/domains.js",
    compiler: "src/blueprint-compiler.js",
    chart: "src/chart-renderer.js",
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function escapeScript(value) {
    return value.replaceAll("</script>", "<\\/script>");
  }

  function readNodeAsset(path) {
    return require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", path),
      "utf8",
    );
  }

  async function loadBrowserAssets() {
    const entries = await Promise.all(
      Object.entries(assetPaths).map(async ([key, path]) => {
        const response = await fetch(`/${path}`);
        if (!response.ok) throw new Error(`Cannot load ${path}`);
        return [key, await response.text()];
      }),
    );
    return Object.fromEntries(entries);
  }

  function buildStandaloneHtml(payload = {}) {
    if (typeof process !== "undefined" && process.versions?.node) {
      const assets = Object.fromEntries(
        Object.entries(assetPaths).map(([key, path]) => [
          key,
          readNodeAsset(path),
        ]),
      );
      return Promise.resolve(buildFromAssets(payload, assets));
    }
    return loadBrowserAssets().then((assets) =>
      buildFromAssets(payload, assets),
    );
  }

  function buildFromAssets(payload, assets) {
    const compilerApi =
      typeof window !== "undefined" && window.PhenomenaCompiler
        ? window.PhenomenaCompiler
        : require("./blueprint-compiler.js");
    const domainsApi =
      typeof window !== "undefined" && window.Domains
        ? window.Domains
        : require("./domains.js");
    const domain = payload.blueprint
      ? compilerApi.compileBlueprint(payload.blueprint, {
          index: payload.blueprint.index || "DYN",
        })
      : domainsApi.getDomain(payload.domainId || "pulse");
    const params = domainsApi.normalizeParams(domain, payload.params || {});
    const accent = domain.palette[0];
    const secondary = domain.palette[1];
    const isDynamic = Boolean(payload.blueprint);
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(domain.name)} · Phenomena Instrument</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #07110f;
        --panel: #0d1917;
        --line: rgba(192, 230, 214, 0.13);
        --text: #e4efe9;
        --muted: #81968e;
        --accent: ${accent};
        --secondary: ${secondary};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--text);
        background:
          radial-gradient(circle at 15% -10%, ${accent}18, transparent 32%),
          radial-gradient(circle at 92% 15%, ${secondary}10, transparent 30%),
          var(--bg);
        font-family: "Avenir Next", "PingFang SC", "Helvetica Neue", sans-serif;
      }
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        opacity: 0.23;
        background-image: linear-gradient(rgba(200,236,220,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(200,236,220,.055) 1px, transparent 1px);
        background-size: 48px 48px;
        mask-image: radial-gradient(circle at center, black, transparent 85%);
      }
      main { position: relative; max-width: 1460px; margin: 0 auto; padding: 34px clamp(18px, 4vw, 64px) 50px; }
      header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
      .eyebrow { color: var(--muted); font: 600 9px/1.4 "SFMono-Regular", Menlo, monospace; letter-spacing: 0.2em; text-transform: uppercase; }
      h1 { margin: 14px 0 0; font-family: "Iowan Old Style", "Songti SC", Georgia, serif; font-size: clamp(35px, 5.5vw, 70px); font-weight: 500; letter-spacing: -0.055em; line-height: 0.98; }
      .subtitle { margin: 10px 0 0; color: var(--accent); font-size: 13px; letter-spacing: 0.1em; }
      .meta { max-width: 330px; color: var(--muted); font: 9px/1.7 "SFMono-Regular", Menlo, monospace; text-align: right; }
      .meta strong { display: block; margin-bottom: 5px; color: var(--accent); font-size: 9px; letter-spacing: 0.1em; }
      .question { max-width: 800px; margin: 20px 0 0; color: #b9cac3; font-size: 14px; line-height: 1.8; }
      .layout { display: grid; grid-template-columns: minmax(0, 1fr) 335px; gap: 18px; margin-top: 26px; }
      .plot, .controls, .insight { border: 1px solid var(--line); background: linear-gradient(145deg, rgba(19,38,34,.9), rgba(10,20,18,.93)); }
      .plot { min-width: 0; min-height: 535px; padding: 19px; }
      .plot__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 14px; }
      .plot h2, .controls h2 { margin: 5px 0 0; font-size: 14px; font-weight: 500; }
      .plot__legend { color: var(--muted); font: 8px/1.55 "SFMono-Regular", Menlo, monospace; text-align: right; }
      .canvas-wrap { height: 438px; min-height: 320px; background: radial-gradient(ellipse at center, rgba(36,75,64,.15), transparent 66%); }
      canvas { display: block; width: 100%; height: 100%; }
      .chart-readout { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 12px; border-top: 1px solid var(--line); }
      .metric { padding: 12px 10px 0; border-right: 1px solid var(--line); }
      .metric:last-child { border-right: 0; }
      .metric span { display: block; color: var(--muted); font: 8px/1.4 "SFMono-Regular", Menlo, monospace; letter-spacing: 0.07em; }
      .metric strong { display: block; margin-top: 4px; font: 400 21px/1.4 "SFMono-Regular", Menlo, monospace; }
      .metric small { margin-left: 4px; color: var(--muted); font-size: 8px; }
      .controls { padding: 20px; }
      .control { padding: 16px 0 14px; border-bottom: 1px solid var(--line); }
      .control:last-child { border-bottom: 0; }
      .control__head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
      .control label { color: #c2d3cc; font-size: 10px; }
      .control output { color: var(--accent); font: 8px/1 "SFMono-Regular", Menlo, monospace; }
      input[type=range] { width: 100%; margin: 14px 0 6px; accent-color: var(--accent); }
      .control__scale { display: flex; justify-content: space-between; color: #647a72; font: 7px/1.4 "SFMono-Regular", Menlo, monospace; }
      .insight { margin-top: 14px; padding: 18px; border-left: 2px solid var(--accent); }
      .insight p { margin: 8px 0 0; color: #b9cac3; font-size: 10px; line-height: 1.7; }
      .formula { margin-top: 15px; padding-top: 12px; color: #789088; border-top: 1px solid var(--line); font: 8px/1.75 "SFMono-Regular", Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
      footer { display: flex; justify-content: space-between; gap: 14px; margin-top: 22px; padding-top: 13px; color: #60776e; border-top: 1px solid var(--line); font: 7px/1.5 "SFMono-Regular", Menlo, monospace; letter-spacing: 0.07em; }
      @media (max-width: 850px) {
        .layout { grid-template-columns: 1fr; }
        header { align-items: flex-start; flex-direction: column; }
        .meta { text-align: left; }
        .plot { min-height: 420px; }
        .canvas-wrap { height: 330px; }
      }
      @media (max-width: 520px) {
        main { padding: 22px 14px 35px; }
        .plot, .controls { padding: 14px; }
        .canvas-wrap { height: 280px; }
        footer { flex-direction: column; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <span class="eyebrow">PHENOMENA / SELF-CONTAINED INSTRUMENT</span>
          <h1>${escapeHtml(domain.name)}</h1>
          <p class="subtitle">${escapeHtml(domain.subtitle)}</p>
        </div>
        <div class="meta">
          <strong>REAL NUMERICAL CORE · ${escapeHtml(domain.shortName)}</strong>
          ${escapeHtml(domain.algorithm)}
        </div>
      </header>
      <p class="question">${escapeHtml(domain.question)}</p>
      <div class="layout">
        <section class="plot">
          <div class="plot__head">
            <div>
              <span class="eyebrow">INTERACTIVE VIEW</span>
              <h2>${escapeHtml(domain.views[0].label)}</h2>
            </div>
            <span class="plot__legend">灰色虚线 = 初始参考<br />彩色发光 = 当前响应</span>
          </div>
          <div class="canvas-wrap"><canvas id="main"></canvas></div>
          <div class="chart-readout" id="metrics"></div>
        </section>
        <aside>
          <section class="controls">
            <span class="eyebrow">CONTROL SURFACE</span>
            <h2>物理参数</h2>
            <div id="controls"></div>
          </section>
          <section class="insight">
            <span class="eyebrow">LIVE INTERPRETATION</span>
            <p id="insight">${escapeHtml(domain.goal)}</p>
            <div class="formula">${escapeHtml(domain.equations.join("\n"))}</div>
          </section>
        </aside>
      </div>
      <footer>
        <span>GENERATED BY PHENOMENA · OFFLINE RUNTIME</span>
        <span>window.__SIM_CONTROLLER__ READY</span>
      </footer>
    </main>
    <script>${escapeScript(assets.simmath)}</script>
    <script>${escapeScript(assets.compiler)}</script>
    <script>${escapeScript(assets.domains)}</script>
    <script>${escapeScript(assets.chart)}</script>
    <script>
      const domain = ${
        payload.blueprint
          ? `PhenomenaCompiler.compileBlueprint(${JSON.stringify(
              JSON.parse(JSON.stringify(domain.blueprint || payload.blueprint)),
            )})`
          : `Domains.getDomain(${JSON.stringify(domain.id)})`
      };
      let params = Domains.normalizeParams(domain, ${JSON.stringify(params)});
      let result = null;
      const baselineParams = domain.presets[0]
        ? Domains.normalizeParams(domain, domain.presets[0].params)
        : params;
      const baselineResult = domain.compute(baselineParams);
      const canvas = document.querySelector("#main");
      const controls = document.querySelector("#controls");

      function getPrimarySeries(nextResult) {
        const view =
          domain.views[0] ||
          domain.blueprint?.visual_views?.[0] ||
          {};
        return (
          nextResult.series?.[view.seriesId] ||
          nextResult.series?.[view.series_id] ||
          Object.entries(nextResult.series || {}).find(
            ([key]) => key !== "baseline" && key !== "current",
          )?.[1] ||
          nextResult.series?.current ||
          []
        );
      }

      function decimalPlaces(step) {
        const text = String(step);
        return text.includes(".") ? text.split(".")[1].length : 0;
      }

      function renderControls() {
        controls.innerHTML = domain.controls.map((control) => \`
          <div class="control">
            <div class="control__head">
              <label for="\${control.id}">\${control.symbol} · \${control.label}</label>
              <output id="out-\${control.id}"></output>
            </div>
            <input id="\${control.id}" type="range" min="\${control.min}" max="\${control.max}" step="\${control.step}" value="\${params[control.id]}" />
            <div class="control__scale"><span>\${control.min} \${control.unit}</span><span>\${control.max} \${control.unit}</span></div>
          </div>
        \`).join("");
        domain.controls.forEach((control) => {
          const input = document.querySelector(\`#\${control.id}\`);
          input.value = params[control.id];
          input.addEventListener("input", (event) => {
            params = Domains.normalizeParams(domain, { ...params, [control.id]: Number(event.target.value) });
            render();
          });
        });
      }

      function render() {
        result = domain.compute(params);
        domain.controls.forEach((control) => {
          document.querySelector(\`#out-\${control.id}\`).textContent =
            Number(params[control.id]).toFixed(decimalPlaces(control.step)) + " " + control.unit;
        });
        const width = canvas.parentElement.clientWidth;
        const height = canvas.parentElement.clientHeight;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const currentSeries = getPrimarySeries(result);
        const baselineSeries = getPrimarySeries(baselineResult);
        if (${isDynamic ? "false" : `domain.id === "cnn"`}) {
          PhenomenaChart.renderTriptych(canvas, result, { width, height, dpr });
        } else {
          const yMax = Math.max(
            1,
            ...currentSeries.map(Math.abs),
            ...baselineSeries.map(Math.abs),
          ) * 1.1;
          PhenomenaChart.renderPlot(canvas, {
            width,
            height,
            dpr,
            series: [
              {
                values: baselineSeries,
                x: baselineResult.x,
                color: "#71847e",
                width: 1.2,
                alpha: 0.65,
                dash: [5, 5],
              },
              {
                values: currentSeries,
                x: result.x,
                color: "${accent}",
                width: 1.8,
                glow: "${accent}55",
                fill: "${accent}12",
              }
            ],
            xDomain:
              result.axes.xRange ||
              [0, Math.max(0, (result.series?.current || currentSeries).length - 1)],
            yDomain: ${
              payload.blueprint
                ? "result.axes.yRange"
                : `domain.id === "pulse" ? result.axes.yRange : [-yMax, yMax]`
            },
            xLabel: result.axes.xLabel,
            yLabel: result.axes.yLabel,
          });
        }
        document.querySelector("#metrics").innerHTML = domain.metrics.map((metric) => {
          const value = result.metrics[metric.key];
          const percent = metric.key === "activationFraction" || metric.key === "periodError";
          const shown = percent ? value * 100 : value;
          const unit = percent ? "%" : metric.unit;
          return \`<div class="metric"><span>\${metric.label}</span><strong>\${Number(shown).toFixed(metric.digits)}<small>\${unit}</small></strong></div>\`;
        }).join("");
        document.querySelector("#insight").textContent = result.insight;
      }

      window.__SIM_CONTROLLER__ = {
        setParams: (next) => {
          params = Domains.normalizeParams(domain, next);
          renderControls();
          render();
          return window.__SIM_CONTROLLER__.getStateMetrics();
        },
        getStateMetrics: () => {
          const sequences = Object.values(result.series || {}).filter(Array.isArray);
          const finite = sequences.every((series) => SimMath.finiteStats(series).finite);
          return {
            domain: domain.id,
            params: { ...params },
            metrics: result.metrics,
            seriesFinite: finite,
            hasNaN: sequences.some((series) => SimMath.finiteStats(series).hasNaN),
            trace: SimMath.hashSignal(sequences.flat()),
          };
        },
      };
      renderControls();
      render();
      window.addEventListener("resize", render);
    </script>
  </body>
</html>`;
  }

  root.buildStandaloneHtml = buildStandaloneHtml;
  if (typeof module === "object" && module.exports) {
    module.exports = { buildStandaloneHtml };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
