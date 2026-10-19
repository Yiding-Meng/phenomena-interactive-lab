const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { compileBlueprint } = require("../src/blueprint-compiler.js");
const { buildStandaloneHtml } = require("../src/standalone-builder.js");

function blueprint() {
  return {
    id: "export_wave",
    concept_title: "可导出波",
    short_name: "EXPORT / WAVE",
    pedagogical_goal: "验证动态蓝图也能离线导出。",
    mathematical_model: {
      governing_equations_latex: ["y(t)=e^{-\\gamma t}\\sin(\\omega t)"],
      pipeline: [
        {
          id: "wave",
          kind: "series",
          label: "时间响应",
          expression: "exp(-gamma * t) * sin(omega * t)",
          sampleCount: 120,
          xMin: 0,
          xMax: 10,
        },
      ],
    },
    interactive_controls: [
      {
        id: "omega",
        label: "角频率",
        symbol: "omega",
        min: 0.5,
        max: 5,
        step: 0.1,
        default: 2,
      },
      {
        id: "gamma",
        label: "衰减",
        symbol: "gamma",
        min: 0.01,
        max: 2,
        step: 0.01,
        default: 0.2,
      },
    ],
    aha_presets: [
      {
        id: "default",
        name: "默认",
        description: "默认状态",
        param_values: { omega: 2, gamma: 0.2 },
      },
    ],
    visual_views: [{ type: "2D_Plot" }],
  };
}

test("standalone builder embeds dynamic compiler and blueprint", async () => {
  const html = await buildStandaloneHtml({
    domainId: "dynamic",
    params: { omega: 1, gamma: 0.3 },
    blueprint: blueprint(),
  });
  assert.match(html, /PhenomenaCompiler\.compileBlueprint/);
  assert.match(html, /root\.PhenomenaCompiler = api/);
  assert.match(html, /domain\.compute\(params\)/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<h2>undefined<\/h2>/);
});

test("dynamic compile accepts the emitted blueprint", () => {
  const domain = compileBlueprint(blueprint());
  const result = domain.compute({ omega: 2, gamma: 0.2 });
  assert.equal(result.checks.finite, true);
  assert.equal(result.series.wave.length, 120);
});

test("standalone dynamic export uses the first preset as a fixed Ghost Baseline", async () => {
  const html = await buildStandaloneHtml({
    params: { omega: 1, gamma: 0.3 },
    blueprint: blueprint(),
  });
  assert.match(html, /baselineResult = domain\.compute\(baselineParams\)/);
  assert.match(html, /getPrimarySeries\(baselineResult\)/);
  assert.match(html, /x: baselineResult\.x/);
  assert.doesNotMatch(html, /domain\.db\.compute/);
});

test("standalone static export keeps the bundled domain kernels intact", async () => {
  const html = await buildStandaloneHtml({
    domainId: "pulse",
    params: { gdd: 360, chirp: 0, tod: 0, pulseWidth: 18 },
  });
  assert.match(html, /Domains\.getDomain\("pulse"\)/);
  assert.match(html, /domain\.compute\(params\)/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1],
  );
  const context = { console, setTimeout, clearTimeout };
  context.window = context;
  vm.createContext(context);
  for (const script of scripts.slice(0, 4)) {
    vm.runInContext(script, context);
  }
  assert.equal(typeof context.SimMath.fft, "function");
  assert.equal(typeof context.Domains.getDomain, "function");
  assert.equal(context.Domains.getDomain("pulse").id, "pulse");
});
