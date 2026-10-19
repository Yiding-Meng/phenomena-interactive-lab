const test = require("node:test");
const assert = require("node:assert/strict");
const SimMath = require("../src/simmath.js");

test("FFT followed by inverse FFT recovers the original signal", () => {
  const original = [1, 0.5, -0.25, 0.8, 0, -0.5, 0.3, 0.1];
  const transformed = SimMath.fft(original, new Array(original.length).fill(0));
  const recovered = SimMath.ifft(transformed.re, transformed.im);
  recovered.re.forEach((value, index) => {
    assert.ok(Math.abs(value - original[index]) < 1e-10);
    assert.ok(Math.abs(recovered.im[index]) < 1e-10);
  });
});

test("FFT rejects non-power-of-two lengths", () => {
  assert.throws(() => SimMath.fft([1, 2, 3], [0, 0, 0]), /power of two/);
});

test("RK4 integrates a conservative oscillator with bounded energy", () => {
  const result = SimMath.rk4(
    (_t, state) => [state[1], -state[0]],
    [1, 0],
    0,
    Math.PI * 2,
    0.005,
  );
  const final = result.y.at(-1);
  assert.ok(Math.abs(final[0] - 1) < 1e-4);
  assert.ok(Math.abs(final[1]) < 1e-4);
});

test("matrix inverse round-trips", () => {
  const matrix = [
    [4, 7, 2],
    [3, 6, 1],
    [2, 5, 3],
  ];
  const identity = SimMath.matMul(matrix, SimMath.matInverse(matrix));
  identity.forEach((row, rowIndex) =>
    row.forEach((value, columnIndex) =>
      assert.ok(Math.abs(value - (rowIndex === columnIndex ? 1 : 0)) < 1e-10),
    ),
  );
});

test("FWHM estimator returns the width of a triangular pulse", () => {
  const x = [-2, -1, 0, 1, 2];
  const y = [0, 0.5, 1, 0.5, 0];
  assert.equal(SimMath.estimateFWHM(x, y), 2);
});

test("finiteStats distinguishes NaN and Infinity", () => {
  assert.deepEqual(SimMath.finiteStats([1, Number.NaN]).hasNaN, true);
  assert.deepEqual(SimMath.finiteStats([1, Infinity]).hasInfinity, true);
  assert.equal(SimMath.finiteStats([1, 2, 3]).finite, true);
});
