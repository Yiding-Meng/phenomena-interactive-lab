const test = require("node:test");
const assert = require("node:assert/strict");
const {
  dynamicStatus,
  generateBlueprint,
} = require("../src/generation-service.js");

function fakeCompletion(content) {
  return async () => ({
    content: JSON.stringify(content),
    model: "fake-planner",
    usage: { prompt_tokens: 12, completion_tokens: 34 },
  });
}

function validBlueprint() {
  return {
    status: "supported",
    id: "rc_wave",
    concept_title: "RC 充放电",
    short_name: "RC / TRANSIENT",
    subtitle: "时间常数",
    question: "电阻和电容如何决定电压衰减？",
    pedagogical_goal: "通过改变时间常数，理解指数衰减的速率。",
    mathematical_model: {
      governing_equations_latex: ["V(t)=V_0e^{-t/RC}"],
      numerical_algorithm: "逐点计算指数衰减。",
      pipeline: [
        {
          id: "voltage",
          kind: "series",
          label: "电压",
          unit: "V",
          expression: "v0 * exp(-t / tau)",
          sampleCount: 220,
          xMin: 0,
          xMax: 10,
        },
        {
          id: "half_life",
          kind: "scalar",
          expression: "tau * log(2)",
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
        physical_effect: "增大后衰减更慢。",
      },
      {
        id: "v0",
        label: "初始电压",
        symbol: "v0",
        unit: "V",
        min: 1,
        max: 12,
        step: 0.5,
        default: 5,
        physical_effect: "成比例放大整条曲线。",
      },
    ],
    aha_presets: [
      {
        id: "fast",
        name: "快速放电",
        description: "较小时间常数。",
        param_values: { tau: 0.5, v0: 5 },
      },
      {
        id: "slow",
        name: "慢速放电",
        description: "较大时间常数。",
        param_values: { tau: 4, v0: 5 },
      },
    ],
    visual_views: [{ type: "2D_Plot" }],
  };
}

test("dynamic status is safe without an API key", () => {
  const status = dynamicStatus({});
  assert.equal(status.configured, false);
  assert.equal(status.examples.length, 4);
});

test("generateBlueprint validates model output and probes boundaries", async () => {
  const result = await generateBlueprint({
    text: "RC 电路电压随时间指数衰减",
    env: { DEEPSEEK_API_KEY: "test-key" },
    completion: fakeCompletion(validBlueprint()),
  });
  assert.equal(result.domain.name, "RC 充放电");
  assert.equal(result.blueprint.status, "supported");
  assert.equal(result.exampleId, "pulse");
  assert.equal(result.preview.boundaryDiffers, true);
});

test("generateBlueprint forwards malformed JSON as a structured failure", async () => {
  await assert.rejects(
    () =>
      generateBlueprint({
        text: "未知概念",
        env: { DEEPSEEK_API_KEY: "test-key" },
        completion: async () => ({ content: "not-json" }),
      }),
    /不是合法 JSON/,
  );
});

test("generateBlueprint rejects unsupported planner responses", async () => {
  const response = validBlueprint();
  response.status = "unsupported";
  response.reason = "需要三体混沌的长时间相图。";
  await assert.rejects(
    () =>
      generateBlueprint({
        text: "三体运动",
        env: { DEEPSEEK_API_KEY: "test-key" },
        completion: fakeCompletion(response),
      }),
    /需要三体混沌/,
  );
});
