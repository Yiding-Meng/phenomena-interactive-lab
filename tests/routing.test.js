const test = require("node:test");
const assert = require("node:assert/strict");
const { routeConcept } = require("../src/routing.js");

test("routes Chinese dispersion concepts", () => {
  assert.equal(routeConcept("超短脉冲的群延迟色散与啁啾").domainId, "pulse");
});

test("routes Chinese resonance concepts", () => {
  assert.equal(routeConcept("受迫振动的阻尼共振").domainId, "oscillator");
});

test("routes CNN receptive-field concepts", () => {
  assert.equal(
    routeConcept("卷积神经网络的感受野与卷积核").domainId,
    "cnn",
  );
});

test("routes pendulum small-angle concepts", () => {
  assert.equal(routeConcept("单摆的小角度近似何时失效").domainId, "pendulum");
});

test("routes English concepts", () => {
  assert.equal(routeConcept("pulse dispersion and chirp").domainId, "pulse");
  assert.equal(routeConcept("driven harmonic oscillator").domainId, "oscillator");
  assert.equal(routeConcept("CNN receptive field").domainId, "cnn");
  assert.equal(routeConcept("nonlinear pendulum").domainId, "pendulum");
});

test("rejects concepts unsupported by the local kernels", () => {
  const result = routeConcept("股票市场的情绪传染");
  assert.equal(result.domainId, null);
  assert.match(result.message, /尚未覆盖|不足/);
});
