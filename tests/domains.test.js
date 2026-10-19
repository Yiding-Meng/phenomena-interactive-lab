const test = require("node:test");
const assert = require("node:assert/strict");
const Domains = require("../src/domains.js");

function numericSeries(result) {
  const series = Object.values(result.series || {}).filter(Array.isArray);
  if (result.activation) series.push(result.activation.flat());
  return series;
}

for (const summary of Domains.listDomains()) {
  const domain = Domains.getDomain(summary.id);

  test(`${domain.id}: controls have sane bounds and defaults`, () => {
    for (const control of domain.controls) {
      assert.ok(control.min < control.max);
      assert.ok(control.step > 0);
      assert.ok(control.default >= control.min && control.default <= control.max);
    }
  });

  test(`${domain.id}: boundary combinations remain finite`, () => {
    const combinations = [
      Object.fromEntries(domain.controls.map((control) => [control.id, control.min])),
      Object.fromEntries(domain.controls.map((control) => [control.id, control.max])),
      Object.fromEntries(
        domain.controls.map((control) => [
          control.id,
          (control.min + control.max) / 2,
        ]),
      ),
    ];
    for (const params of combinations) {
      const result = Domains.compute(domain.id, params);
      assert.equal(result.checks.finite, true);
      for (const series of numericSeries(result)) {
        const stats = require("../src/simmath.js").finiteStats(series);
        assert.equal(stats.hasNaN, false);
        assert.equal(stats.hasInfinity, false);
      }
    }
  });

  test(`${domain.id}: every preset computes a finite result`, () => {
    for (const preset of domain.presets) {
      const params = Domains.presetParams(domain, preset.id);
      const result = Domains.compute(domain.id, params);
      assert.equal(result.checks.finite, true);
      for (const series of numericSeries(result)) {
        assert.equal(require("../src/simmath.js").finiteStats(series).finite, true);
      }
    }
  });
}

test("dispersion: GDD broadens a transform-limited pulse", () => {
  const base = Domains.presetParams(Domains.getDomain("pulse"), "transform-limited");
  const stretched = Domains.presetParams(Domains.getDomain("pulse"), "gdd-stretch");
  const a = Domains.compute("pulse", base);
  const b = Domains.compute("pulse", stretched);
  assert.ok(b.metrics.fwhm > a.metrics.fwhm * 2);
  assert.ok(b.metrics.peak <= a.metrics.peak);
});

test("dispersion: negative GDD can compensate positive initial chirp", () => {
  const compensated = Domains.compute(
    "pulse",
    Domains.presetParams(Domains.getDomain("pulse"), "compensation"),
  );
  assert.ok(compensated.metrics.broadening < 1.1);
});

test("oscillator: damping reduces the resonant peak", () => {
  const domain = Domains.getDomain("oscillator");
  const light = Domains.compute("oscillator", {
    ...Domains.defaultParams(domain),
    damping: 0.16,
  });
  const heavy = Domains.compute("oscillator", {
    ...Domains.defaultParams(domain),
    damping: 0.9,
  });
  assert.ok(light.metrics.steadyAmplitude > heavy.metrics.steadyAmplitude);
});

test("CNN: stride controls the output feature-map resolution", () => {
  const domain = Domains.getDomain("cnn");
  const strideOne = Domains.compute("cnn", {
    ...Domains.defaultParams(domain),
    stride: 1,
  });
  const strideTwo = Domains.compute("cnn", {
    ...Domains.defaultParams(domain),
    stride: 2,
  });
  assert.equal(strideOne.metrics.outputSize, 48);
  assert.equal(strideTwo.metrics.outputSize, 24);
});

test("pendulum: amplitude changes the nonlinear period", () => {
  const domain = Domains.getDomain("pendulum");
  const small = Domains.compute(
    "pendulum",
    Domains.presetParams(domain, "small-angle"),
  );
  const large = Domains.compute(
    "pendulum",
    Domains.presetParams(domain, "large-angle"),
  );
  assert.ok(large.metrics.estimatedPeriod > small.metrics.estimatedPeriod);
  assert.ok(large.metrics.periodError > small.metrics.periodError);
});
