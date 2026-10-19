const test = require("node:test");
const assert = require("node:assert/strict");
const { compileBlueprint } = require("../src/blueprint-compiler.js");

function exampleBlueprint() {
  return {
    id: "test_wave",
    concept_title: "测试波",
    short_name: "TEST / WAVE",
    pedagogical_goal: "观察频率与阻尼如何改变波形。",
    mathematical_model: {
      governing_equations_latex: ["y(t)=e^{-\\gamma t}\\sin(\\omega t)"],
      numerical_algorithm: "逐点计算衰减正弦。",
      pipeline: [
        {
          id: "wave",
          kind: "series",
          label: "时间响应",
          unit: "a.u.",
          expression: "exp(-gamma * t) * sin(omega * t)",
          sampleCount: 240,
          xMin: 0,
          xMax: 12,
        },
        {
          id: "mean_amplitude",
          kind: "scalar",
          expression: "gamma + omega",
        },
      ],
    },
    interactive_controls: [
      {
        id: "omega",
        label: "角频率",
        symbol: "omega",
        unit: "rad/s",
        min: 0.5,
        max: 5,
        step: 0.1,
        default: 2,
        physical_effect: "增大后振荡周期缩短。",
      },
      {
        id: "gamma",
        label: "衰减率",
        symbol: "gamma",
        unit: "s^-1",
        min: 0.01,
        max: 2,
        step: 0.01,
        default: 0.2,
        physical_effect: "增大后包络衰减更快。",
      },
    ],
    aha_presets: [
      {
        id: "slow",
        name: "慢振荡",
        description: "低频长周期。",
        param_values: { omega: 1, gamma: 0.05 },
      },
      {
        id: "fast",
        name: "快振荡",
        description: "高频短周期。",
        param_values: { omega: 4, gamma: 0.4 },
      },
    ],
    visual_views: [{ type: "Dual_Plot" }],
  };
}

test("blueprint compiler evaluates a real deterministic series", () => {
  const domain = compileBlueprint(exampleBlueprint());
  const result = domain.compute(domain.controls.reduce((params, control) => {
    params[control.id] = control.default;
    return params;
  }, {}));
  assert.equal(result.checks.finite, true);
  assert.equal(result.series.wave.length, 240);
  assert.deepEqual(result.series.baseline, result.series.wave);
  assert.ok(result.metrics.outputSpan > 0);
  assert.ok(result.series.wave.some((value) => value < 0));
  assert.ok(result.series.wave.some((value) => value > 0));
});

test("blueprint compiler rejects non-whitelisted code", () => {
  const blueprint = exampleBlueprint();
  blueprint.mathematical_model.pipeline[0].expression =
    "fetch('https://example.com')";
  assert.throws(() => compileBlueprint(blueprint), /不允许|未知/);
});

test("blueprint compiler clamps preset and runtime parameters to safe bounds", () => {
  const blueprint = exampleBlueprint();
  blueprint.aha_presets[0].param_values.omega = 999;
  const domain = compileBlueprint(blueprint);
  const preset = domain.presets[0];
  assert.equal(preset.params.omega, 5);
  const result = domain.compute({ omega: -100, gamma: 100 });
  assert.ok(result.params.omega >= 0.5 && result.params.omega <= 5);
  assert.ok(result.params.gamma >= 0.01 && result.params.gamma <= 2);
  assert.equal(result.checks.finite, true);
});

test("blueprint compiler rejects views it cannot safely render", () => {
  const blueprint = exampleBlueprint();
  blueprint.visual_views[0].type = "Vector_Field";
  assert.throws(() => compileBlueprint(blueprint), /当前动态编译器支持/);
});
