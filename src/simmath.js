(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SimMath = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TAU = Math.PI * 2;

  function assertFiniteNumber(value, label) {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function linspace(start, end, count) {
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError("linspace count must be a positive integer");
    }
    if (count === 1) return [start];
    const step = (end - start) / (count - 1);
    return Array.from({ length: count }, (_, index) => start + index * step);
  }

  function arange(start, end, step) {
    assertFiniteNumber(start, "start");
    assertFiniteNumber(end, "end");
    assertFiniteNumber(step, "step");
    if (step === 0) throw new RangeError("step cannot be zero");
    const count = Math.max(0, Math.ceil((end - start) / step));
    return Array.from({ length: count }, (_, index) => start + index * step);
  }

  function isPowerOfTwo(value) {
    return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
  }

  function nextPowerOfTwo(value) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError("value must be a positive integer");
    }
    let result = 1;
    while (result < value) result <<= 1;
    return result;
  }

  function fft(re, im, inverse) {
    const n = re.length;
    if (im.length !== n) throw new RangeError("re and im must have equal lengths");
    if (!isPowerOfTwo(n)) throw new RangeError("FFT length must be a power of two");

    const real = Float64Array.from(re);
    const imag = im ? Float64Array.from(im) : new Float64Array(n);

    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let temp = real[i];
        real[i] = real[j];
        real[j] = temp;
        temp = imag[i];
        imag[i] = imag[j];
        imag[j] = temp;
      }
    }

    for (let length = 2; length <= n; length <<= 1) {
      const angle = (inverse ? TAU : -TAU) / length;
      const stepReal = Math.cos(angle);
      const stepImag = Math.sin(angle);
      const half = length >> 1;

      for (let start = 0; start < n; start += length) {
        let phaseReal = 1;
        let phaseImag = 0;

        for (let offset = 0; offset < half; offset += 1) {
          const evenIndex = start + offset;
          const oddIndex = evenIndex + half;
          const oddReal =
            real[oddIndex] * phaseReal - imag[oddIndex] * phaseImag;
          const oddImag =
            real[oddIndex] * phaseImag + imag[oddIndex] * phaseReal;
          const evenReal = real[evenIndex];
          const evenImag = imag[evenIndex];

          real[evenIndex] = evenReal + oddReal;
          imag[evenIndex] = evenImag + oddImag;
          real[oddIndex] = evenReal - oddReal;
          imag[oddIndex] = evenImag - oddImag;

          const nextPhaseReal =
            phaseReal * stepReal - phaseImag * stepImag;
          phaseImag = phaseReal * stepImag + phaseImag * stepReal;
          phaseReal = nextPhaseReal;
        }
      }
    }

    if (inverse) {
      for (let i = 0; i < n; i += 1) {
        real[i] /= n;
        imag[i] /= n;
      }
    }

    return { re: Array.from(real), im: Array.from(imag) };
  }

  function ifft(re, im) {
    return fft(re, im, true);
  }

  function fftShift(values) {
    const midpoint = Math.floor(values.length / 2);
    return values.slice(midpoint).concat(values.slice(0, midpoint));
  }

  function complexAbs(re, im) {
    return re.map((value, index) => Math.hypot(value, im[index]));
  }

  function unwrapPhase(phases) {
    if (!phases.length) return [];
    const output = [phases[0]];
    let offset = 0;
    for (let i = 1; i < phases.length; i += 1) {
      const delta = phases[i] + offset - output[i - 1];
      if (delta > Math.PI) offset -= TAU;
      if (delta < -Math.PI) offset += TAU;
      output.push(phases[i] + offset);
    }
    return output;
  }

  function addVectors(a, b) {
    return a.map((value, index) => value + b[index]);
  }

  function scaleVector(vector, factor) {
    return vector.map((value) => value * factor);
  }

  function cloneState(value) {
    return Array.isArray(value) || ArrayBuffer.isView(value)
      ? Array.from(value)
      : value;
  }

  function rk4(fn, y0, t0, tf, dt) {
    assertFiniteNumber(t0, "t0");
    assertFiniteNumber(tf, "tf");
    assertFiniteNumber(dt, "dt");
    if (dt <= 0 || tf < t0) throw new RangeError("require dt > 0 and tf >= t0");

    let t = t0;
    let y = cloneState(y0);
    const times = [t];
    const states = [cloneState(y)];
    const maxSteps = 200000;
    let steps = 0;

    while (t < tf - Number.EPSILON * Math.max(1, Math.abs(tf))) {
      if (steps >= maxSteps) throw new RangeError("RK4 exceeded step limit");
      const h = Math.min(dt, tf - t);
      const k1 = fn(t, y);
      const k2 = fn(t + h / 2, addVectors(y, scaleVector(k1, h / 2)));
      const k3 = fn(t + h / 2, addVectors(y, scaleVector(k2, h / 2)));
      const k4 = fn(t + h, addVectors(y, scaleVector(k3, h)));

      y = y.map(
        (value, index) =>
          value +
          (h / 6) *
            (k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index]),
      );
      t += h;
      times.push(t);
      states.push(cloneState(y));
      steps += 1;
    }

    return { t: times, y: states };
  }

  function gaussian(x, mean, sigma) {
    if (sigma <= 0) throw new RangeError("sigma must be positive");
    const z = (x - mean) / sigma;
    return Math.exp(-0.5 * z * z);
  }

  function normalPdf(x, mean, sigma) {
    if (sigma <= 0) throw new RangeError("sigma must be positive");
    const z = (x - mean) / sigma;
    return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(TAU));
  }

  function matMul(a, b) {
    if (!a.length || !b.length || a[0].length !== b.length) {
      throw new RangeError("incompatible matrix dimensions");
    }
    return a.map((row) =>
      Array.from({ length: b[0].length }, (_, column) =>
        row.reduce((sum, value, index) => sum + value * b[index][column], 0),
      ),
    );
  }

  function matInverse(matrix) {
    const n = matrix.length;
    if (!n || matrix.some((row) => row.length !== n)) {
      throw new RangeError("matrix must be square");
    }

    const augmented = matrix.map((row, index) => [
      ...row,
      ...Array.from({ length: n }, (_, column) =>
        index === column ? 1 : 0,
      ),
    ]);

    for (let column = 0; column < n; column += 1) {
      let pivot = column;
      for (let row = column + 1; row < n; row += 1) {
        if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
          pivot = row;
        }
      }
      if (Math.abs(augmented[pivot][column]) < 1e-12) {
        throw new RangeError("matrix is singular");
      }
      [augmented[column], augmented[pivot]] = [
        augmented[pivot],
        augmented[column],
      ];

      const divisor = augmented[column][column];
      augmented[column] = augmented[column].map((value) => value / divisor);

      for (let row = 0; row < n; row += 1) {
        if (row === column) continue;
        const factor = augmented[row][column];
        augmented[row] = augmented[row].map(
          (value, index) => value - factor * augmented[column][index],
        );
      }
    }

    return augmented.map((row) => row.slice(n));
  }

  function estimateFWHM(x, y) {
    if (x.length !== y.length || x.length < 3) {
      throw new RangeError("x and y must have matching lengths greater than 2");
    }
    const maxIndex = y.reduce(
      (best, value, index) => (value > y[best] ? index : best),
      0,
    );
    const half = y[maxIndex] * 0.5;
    if (!(half > 0)) return 0;

    function crossing(direction) {
      let index = maxIndex;
      while (
        index + direction >= 0 &&
        index + direction < y.length &&
        y[index + direction] > half
      ) {
        index += direction;
      }
      if (index + direction < 0 || index + direction >= y.length) return x[index];
      const a = Math.abs(y[index] - half);
      const b = Math.abs(y[index + direction] - half);
      const ratio = a + b < 1e-15 ? 0.5 : a / (a + b);
      return lerp(x[index], x[index + direction], ratio);
    }

    return Math.abs(crossing(1) - crossing(-1));
  }

  function meanSquaredError(a, b) {
    if (a.length !== b.length) throw new RangeError("arrays must match");
    if (!a.length) return 0;
    return (
      a.reduce((sum, value, index) => {
        const delta = value - b[index];
        return sum + delta * delta;
      }, 0) / a.length
    );
  }

  function finiteStats(values) {
    let min = Infinity;
    let max = -Infinity;
    let finite = true;
    let hasNaN = false;
    let hasInfinity = false;

    for (const value of values) {
      if (value === null) continue;
      if (Number.isNaN(value)) {
        finite = false;
        hasNaN = true;
        continue;
      }
      if (!Number.isFinite(value)) {
        finite = false;
        hasInfinity = true;
        continue;
      }
      min = Math.min(min, value);
      max = Math.max(max, value);
    }

    return {
      finite,
      hasNaN,
      hasInfinity,
      min: finite ? min : null,
      max: finite ? max : null,
      count: values.length,
    };
  }

  function hashSignal(values) {
    let hash = 2166136261;
    for (const value of values) {
      const numeric = Number.isFinite(value) ? value : 0;
      const bucket = Math.round((numeric + 64) * 100000);
      hash ^= bucket;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  return {
    TAU,
    addVectors,
    arange,
    clamp,
    complexAbs,
    estimateFWHM,
    fft,
    fftShift,
    finiteStats,
    gaussian,
    hashSignal,
    ifft,
    isPowerOfTwo,
    lerp,
    linspace,
    matInverse,
    matMul,
    meanSquaredError,
    nextPowerOfTwo,
    normalPdf,
    rk4,
    scaleVector,
    smoothstep,
    unwrapPhase,
  };
});
