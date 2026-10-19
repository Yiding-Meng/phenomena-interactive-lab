const pulse = require("./pulse.json");
const oscillator = require("./oscillator.json");
const cnn = require("./cnn.json");
const pendulum = require("./pendulum.json");

const examples = [pulse, oscillator, cnn, pendulum];

function getGoldenExample(id) {
  return examples.find((example) => example.id === id) || null;
}

function selectGoldenExample(text) {
  const normalized = String(text || "").toLowerCase();
  const rules = [
    {
      id: "pulse",
      keywords: ["色散", "脉冲", "啁啾", "频谱", "dispersion", "pulse", "chirp"],
    },
    {
      id: "oscillator",
      keywords: ["振子", "共振", "阻尼", "振荡", "oscillator", "resonance"],
    },
    {
      id: "cnn",
      keywords: ["卷积", "感受野", "cnn", "kernel", "卷积核"],
    },
    {
      id: "pendulum",
      keywords: ["单摆", "摆动", "摆角", "pendulum", "小角度"],
    },
  ];
  const best = rules
    .map((rule) => ({
      ...rule,
      score: rule.keywords.filter((keyword) => normalized.includes(keyword)).length,
    }))
    .sort((a, b) => b.score - a.score)[0];
  return getGoldenExample(best?.id) || pulse;
}

function listGoldenExamples() {
  return examples.map((example) => ({
    id: example.id,
    concept_title: example.concept_title,
    pedagogical_goal: example.pedagogical_goal,
  }));
}

module.exports = {
  examples,
  getGoldenExample,
  listGoldenExamples,
  selectGoldenExample,
};
