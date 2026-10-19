(function (root, factory) {
  const SimMath =
    typeof module === "object" && module.exports
      ? require("./simmath.js")
      : root.SimMath;
  const api = factory(SimMath);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Domains = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SimMath) {
  "use strict";

  const TAU = Math.PI * 2;
  const LG2 = Math.log(2);

  function clampValue(control, value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return control.default;
    return SimMath.clamp(numeric, control.min, control.max);
  }

  function normalizeParams(domain, params) {
    const normalized = {};
    for (const control of domain.controls) {
      normalized[control.id] = clampValue(
        control,
        params?.[control.id] ?? control.default,
      );
    }
    return normalized;
  }

  function resolvePreset(domain, presetId) {
    return (
      domain.presets.find((preset) => preset.id === presetId) || domain.presets[0]
    );
  }

  function defaultParams(domain) {
    return normalizeParams(domain, {});
  }

  function presetParams(domain, presetId) {
    const preset = resolvePreset(domain, presetId);
    return normalizeParams(domain, preset.params);
  }

  function fftFrequencies(n, dt) {
    return Array.from({ length: n }, (_, index) => {
      const wrapped = index > n / 2 ? index - n : index;
      return wrapped / (n * dt);
    });
  }

  function computePulseDispersion(params, options = {}) {
    const p = normalizeParams(getDomain("pulse"), params);
    const n = options.sampleCount || 512;
    const duration = 180;
    const dt = duration / (n - 1);
    const time = SimMath.linspace(-duration / 2, duration / 2, n);
    const sigma = p.pulseWidth / (2 * Math.sqrt(LG2));
    const initial = time.map((t) => Math.exp(-0.5 * (t / sigma) ** 2));
    const real = initial.slice();
    const imag = new Array(n).fill(0);
    const spectrum = SimMath.fft(real, imag);
    const frequencies = fftFrequencies(n, dt);
    const effectiveChirp = p.gdd + p.chirp * 180;

    const shiftedReal = [];
    const shiftedImag = [];
    const frequencyPhase = [];
    for (const frequency of frequencies) {
      const omega = TAU * frequency;
      const phase =
        0.5 * effectiveChirp * omega ** 2 + (p.tod / 6) * omega ** 3;
      frequencyPhase.push(phase);
    }

    for (let index = 0; index < n; index += 1) {
      const phase = frequencyPhase[index];
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      shiftedReal[index] = spectrum.re[index] * c - spectrum.im[index] * s;
      shiftedImag[index] = spectrum.re[index] * s + spectrum.im[index] * c;
    }

    const temporal = SimMath.ifft(shiftedReal, shiftedImag);
    const rawIntensity = temporal.re.map(
      (value, index) => value * value + temporal.im[index] * temporal.im[index],
    );
    const peak = Math.max(...rawIntensity);
    const intensity = rawIntensity.map((value) => value / peak);
    const normalizedInitial = initial.map((value) => value ** 2);
    const fwhm = SimMath.estimateFWHM(time, intensity);
    const initialFwhm = SimMath.estimateFWHM(time, normalizedInitial);
    const spectralMagnitude = SimMath.complexAbs(spectrum.re, spectrum.im);
    const spectralPeak = Math.max(...spectralMagnitude);
    const initialSpectrum = spectrum.re.map(
      (value, index) => value * value + spectrum.im[index] * spectrum.im[index],
    );
    const spectralIntensity = spectralMagnitude.map(
      (value) => (value / spectralPeak) ** 2,
    );
    const initialSpectrumPeak = Math.max(...initialSpectrum);
    const shiftedSpectrum = SimMath.fftShift(spectralIntensity);
    const frequencyStep = 1 / (n * dt);
    const frequencyRange = [-n * frequencyStep / 2, n * frequencyStep / 2];
    const alignedFrequency = SimMath.fftShift(frequencies);
    const alignedPhase = alignedFrequency.map((frequency, index) => {
      if (
        !Number.isFinite(shiftedSpectrum[index]) ||
        shiftedSpectrum[index] < 0.015
      ) {
        return null;
      }
      const omega = TAU * frequency;
      const phase =
        0.5 * p.gdd * omega ** 2 +
        (p.chirp / 45) * omega +
        (p.tod / 6) * omega ** 3;
      return Math.atan2(Math.sin(phase), Math.cos(phase));
    });

    return {
      domain: "pulse",
      params: p,
      x: time,
      series: {
        baseline: normalizedInitial,
        current: intensity,
        spectrumBaseline: SimMath.fftShift(
          initialSpectrum.map((value) => value / initialSpectrumPeak),
        ).map((value) => (value < 0.001 ? null : value)),
        envelope: temporal.re.map((value, index) =>
          Math.hypot(value, temporal.im[index]),
        ),
        spectrum: shiftedSpectrum.map((value) => (value < 0.001 ? null : value)),
        phase: SimMath.unwrapPhase(
          alignedPhase.map((value) => (value === null ? 0 : value)),
        ).map((value, index) => (alignedPhase[index] === null ? null : value)),
      },
      axes: {
        xLabel: "时间 t (fs)",
        yLabel: "归一化强度 |E(t)|²",
        xRange: [-duration / 2, duration / 2],
        yRange: [0, 1.08],
        secondaryXLabel: "角频率偏移 ω (rad/fs)",
        secondaryXRange: frequencyRange,
      },
      metrics: {
        fwhm,
        initialFwhm,
        broadening: fwhm / initialFwhm,
        peak,
        integratedIntensity: rawIntensity.reduce(
          (sum, value) => sum + value * dt,
          0,
        ),
        energy: rawIntensity.reduce((sum, value) => sum + value * dt, 0),
        effectiveChirp,
        spectralWidth: n * frequencyStep,
      },
      checks: {
        finite: [intensity, normalizedInitial, temporal.re, temporal.im].every(
          (series) => SimMath.finiteStats(series).finite,
        ),
      },
      insight:
        Math.abs(p.gdd) < 1
          ? "零 GDD：频谱相位平直，脉冲保持变换极限宽度。"
          : p.gdd > 0
            ? "正 GDD 引入二次相位：不同频率的到达时间被重新排序。"
            : "负 GDD 正在抵消线性啁啾，观察 FWHM 是否回到最小值。",
    };
  }

  function computeQuantumOscillator(params, options = {}) {
    const p = normalizeParams(getDomain("oscillator"), params);
    const duration = 32;
    const dt = 0.006;
    const f = (t, state) => {
      const [x, v] = state;
      const acceleration =
        -(p.omega0 ** 2) * x -
        2 * p.damping * p.omega0 * v +
        p.driveAmp * Math.cos(p.driveFreq * t);
      return [v, acceleration];
    };
    const result = SimMath.rk4(f, [1, 0], 0, duration, dt);
    const time = result.t;
    const position = result.y.map((state) => state[0]);
    const velocity = result.y.map((state) => state[1]);
    const tailStart = Math.floor(position.length * 0.75);
    const tail = position.slice(tailStart);
    const qualityFactor =
      p.damping < 1e-5 ? 999 : p.omega0 / (2 * p.damping);
    const naturalPeriod = TAU / p.omega0;
    const driveFrequencies = SimMath.linspace(0.35, 2.8, 120);
    const resonanceBaseline = driveFrequencies.map(
      (frequency) =>
        p.driveAmp /
        Math.sqrt(
          (p.omega0 ** 2 - frequency ** 2) ** 2 +
          (2 * 0.48 * p.omega0 * frequency) ** 2,
        ),
    );
    const baselinePeak = Math.max(...resonanceBaseline);
    const dampingRatio = p.damping;
    const steadyAmplitude = Math.max(...tail.map(Math.abs));
    const baseline = time.map(
      (t) => Math.cos(p.omega0 * t) * Math.exp(-p.damping * p.omega0 * t),
    );
    const resonanceRaw = driveFrequencies.map(
      (frequency) =>
        p.driveAmp /
        Math.sqrt(
          (p.omega0 ** 2 - frequency ** 2) ** 2 +
          (2 * p.damping * p.omega0 * frequency) ** 2,
        ),
    );
    const resonancePeak = Math.max(...resonanceRaw);
    const resonanceCurve = resonanceRaw.map((value) => value / resonancePeak);

    return {
      domain: "oscillator",
      params: p,
      x: time,
      series: {
        baseline,
        current: position,
        velocity,
        resonanceFrequency: driveFrequencies,
        resonanceCurve,
        resonanceBaseline: resonanceBaseline.map(
          (value) => value / baselinePeak,
        ),
      },
      axes: {
        xLabel: "时间 t (s)",
        yLabel: "位移 x(t)",
        xRange: [0, duration],
        yRange: [-8, 8],
      },
      metrics: {
        qualityFactor,
        naturalPeriod,
        dampingRatio,
        steadyAmplitude,
        resonantRatio: p.driveFreq / p.omega0,
        peakDisplacement: Math.max(...position.map(Math.abs)),
      },
      checks: {
        finite: [position, velocity].every(
          (series) => SimMath.finiteStats(series).finite,
        ),
      },
      insight:
        dampingRatio < 0.35
          ? "低阻尼区间：系统会保留能量，瞬态响应比稳态更醒目。"
          : "阻尼正在吞噬振荡能量；注意峰值随时间的包络衰减。",
    };
  }

  function gaussianKernel(size, sigma) {
    const center = (size - 1) / 2;
    const kernel = [];
    let total = 0;
    for (let y = 0; y < size; y += 1) {
      const row = [];
      for (let x = 0; x < size; x += 1) {
        const distance = (x - center) ** 2 + (y - center) ** 2;
        const value = Math.exp(-distance / (2 * sigma ** 2));
        row.push(value);
        total += value;
      }
      kernel.push(row);
    }
    return kernel.map((row) => row.map((value) => value / total));
  }

  function makeInputImage(size) {
    const image = [];
    for (let y = 0; y < size; y += 1) {
      const row = [];
      for (let x = 0; x < size; x += 1) {
        const nx = (x / (size - 1)) * 2 - 1;
        const ny = (y / (size - 1)) * 2 - 1;
        const body = Math.exp(
          -(((nx / 0.78) ** 2 + ((ny - 0.04) / 0.62) ** 2) * 1.8),
        );
        const stripe =
          0.22 *
          Math.sin(nx * 15 + ny * 3) *
          Math.exp(-(((nx + 0.05) / 0.72) ** 2 + (ny / 0.6) ** 2));
        const ring = 0.33 * Math.exp(-(((Math.hypot(nx, ny) - 0.62) / 0.06) ** 2));
        row.push(SimMath.clamp(body * 0.82 + stripe + ring, 0, 1));
      }
      image.push(row);
    }
    return image;
  }

  function convolve2d(image, kernel, stride) {
    const imageSize = image.length;
    const kernelSize = kernel.length;
    const outputSize = Math.floor(imageSize / stride);
    const output = [];
    let max = 0;
    for (let y = 0; y < outputSize; y += 1) {
      const row = [];
      for (let x = 0; x < outputSize; x += 1) {
        let sum = 0;
        for (let ky = 0; ky < kernelSize; ky += 1) {
          for (let kx = 0; kx < kernelSize; kx += 1) {
            const sourceY = y * stride + ky - Math.floor(kernelSize / 2);
            const sourceX = x * stride + kx - Math.floor(kernelSize / 2);
            const sampled =
              sourceY >= 0 &&
              sourceY < imageSize &&
              sourceX >= 0 &&
              sourceX < imageSize
                ? image[sourceY][sourceX]
                : 0;
            sum += sampled * kernel[ky][kx];
          }
        }
        max = Math.max(max, sum);
        row.push(sum);
      }
      output.push(row);
    }
    return { output, max };
  }

  function computeCnnReceptiveField(params) {
    const p = normalizeParams(getDomain("cnn"), params);
    const baseImage = makeInputImage(48);
    const kernelSize = Math.round(p.kernelSize);
    const kernel = gaussianKernel(kernelSize, p.sigma);
    const image = baseImage;
    const conv = convolve2d(image, kernel, Math.round(p.stride));
    const peak = conv.max || 1;
    const activation = conv.output.map((row) =>
      row.map((value) => Math.max(0, value * p.gain) / peak),
    );
    const flat = activation.flat();
    const activePixels = flat.filter((value) => value > 0.08).length;

    return {
      domain: "cnn",
      params: p,
      image,
      kernel,
      activation,
      axes: {
        xLabel: "输入像素 x",
        yLabel: "输入像素 y",
        xRange: [0, image.length],
        yRange: [0, image.length],
      },
      metrics: {
        receptiveField: kernelSize,
        outputSize: activation.length,
        activationFraction: activePixels / flat.length,
        maxActivation: Math.max(...flat),
        parameterCount: kernelSize * kernelSize,
        effectiveSigma: p.sigma,
      },
      checks: {
        finite: [flat].every((series) => SimMath.finiteStats(series).finite),
      },
      insight:
        p.sigma < 0.9
          ? "小核、小 σ：局部高频纹样被保留，输出像边缘探测器。"
          : p.sigma > 1.7
            ? "大 σ：邻域被平均，细节让位于低频结构。"
            : "感受野正在扩大：注意中心响应如何吞并周围纹理。",
    };
  }

  function computePendulum(params, options = {}) {
    const p = normalizeParams(getDomain("pendulum"), params);
    const duration = 18;
    const dt = 0.004;
    const g = 9.81;
    const f = (_t, state) => [
      state[1],
      -(g / p.length) * Math.sin(state[0]) - p.damping * state[1],
    ];
    const result = SimMath.rk4(
      f,
      [p.theta0, p.initialVelocity],
      0,
      duration,
      dt,
    );
    const time = result.t;
    const theta = result.y.map((state) => state[0]);
    const omega = result.y.map((state) => state[1]);
    const linearApprox = time.map(
      (t) =>
        p.theta0 * Math.cos(Math.sqrt(g / p.length) * t) *
        Math.exp(-0.5 * p.damping * t),
    );
    const linearPeriod = TAU / Math.sqrt(g / p.length);
    const upwardCrossings = [];
    for (let index = 1; index < theta.length; index += 1) {
      if (theta[index - 1] <= 0 && theta[index] > 0) {
        upwardCrossings.push(time[index]);
      }
    }
    const estimatedPeriod =
      upwardCrossings.length > 1
        ? (upwardCrossings.at(-1) - upwardCrossings[0]) /
          (upwardCrossings.length - 1)
        : linearPeriod;
    const linearOmega = linearApprox.map(
      (_value, index) =>
        -p.theta0 *
        Math.sqrt(g / p.length) *
        Math.sin(Math.sqrt(g / p.length) * time[index]) *
        Math.exp(-0.5 * p.damping * time[index]),
    );

    return {
      domain: "pendulum",
      params: p,
      x: time,
      series: {
        baseline: linearApprox,
        current: theta,
        velocity: omega,
        baselineVelocity: linearOmega,
      },
      axes: {
        xLabel: "时间 t (s)",
        yLabel: "摆角 θ (rad)",
        xRange: [0, duration],
        yRange: [-Math.PI, Math.PI],
      },
      metrics: {
        estimatedPeriod,
        linearPeriod,
        periodError: Math.abs(estimatedPeriod - linearPeriod) / linearPeriod,
        maxTheta: Math.max(...theta.map(Math.abs)),
        maxAngularVelocity: Math.max(...omega.map(Math.abs)),
        energy: Math.max(
          ...theta.map(
            (angle, index) =>
              0.5 * (omega[index] ** 2) +
              (g / p.length) * (1 - Math.cos(angle)),
          ),
        ),
      },
      checks: {
        finite: [theta, omega].every(
          (series) => SimMath.finiteStats(series).finite,
        ),
      },
      insight:
        Math.abs(p.theta0) < 0.25
          ? "小角度近似几乎贴合真实轨迹：这是线性化的适用范围。"
          : "大摆角下，真实周期偏离线性近似；这是 sin θ 的非线性代价。",
    };
  }

  const registry = {
    pulse: {
      id: "pulse",
      index: "01",
      name: "色散脉冲整形",
      shortName: "PULSE / DISPERSION",
      subtitle: "看见频率如何重排时间",
      question: "一束超短脉冲穿过色散介质后，为什么会变宽、变丑，又可能被重新压回极限？",
      goal: "在时域与频域的联动中，直观看到 GDD、三阶色散与初始啁啾如何共同决定脉冲包络。",
      equations: [
        "E_{\\mathrm{out}}(t)=\\mathcal{F}^{-1}\\left\\{\\tilde E_0(\\omega)e^{i\\left(\\frac{1}{2}\\beta_2\\omega^2+\\frac{1}{6}\\beta_3\\omega^3\\right)}\\right\\}",
        "I(t)=|E_{\\mathrm{out}}(t)|^2",
      ],
      algorithm:
        "对 512 点高斯包络做 FFT；在频域叠加二次/三次相位；IFFT 回到时域；以初始峰值归一化并计算 FWHM。",
      helpers: ["fft", "ifft", "fftShift", "linspace", "estimateFWHM"],
      palette: ["#7cf7d4", "#8ea2ff", "#ffbb6b"],
      controls: [
        {
          id: "gdd",
          symbol: "φ₂",
          label: "群延迟色散 GDD",
          unit: "fs²",
          min: -600,
          max: 600,
          step: 10,
          default: 0,
          effect: "增大 |GDD| 会重排频率到达时间，使脉冲展宽并改变时域包络。",
        },
        {
          id: "chirp",
          symbol: "C",
          label: "初始线性啁啾",
          unit: "",
          min: -2.5,
          max: 2.5,
          step: 0.05,
          default: 0.85,
          effect: "给频谱加入额外的二次相位偏置，改变正/负 GDD 的补偿关系。",
        },
        {
          id: "tod",
          symbol: "φ₃",
          label: "三阶色散 TOD",
          unit: "fs³",
          min: -1800,
          max: 1800,
          step: 25,
          default: 0,
          effect: "打破时域对称性，产生拖尾、振荡与不对称畸变。",
        },
        {
          id: "pulseWidth",
          symbol: "τ₀",
          label: "初始脉冲宽度",
          unit: "fs",
          min: 8,
          max: 36,
          step: 1,
          default: 18,
          effect: "改变初始频谱宽度，从而改变同样 GDD 下的展宽敏感度。",
        },
      ],
      presets: [
        {
          id: "transform-limited",
          name: "变换极限",
          tag: "REFERENCE",
          description: "所有相位项归零，脉冲保持最短时间宽度。",
          params: { gdd: 0, chirp: 0, tod: 0, pulseWidth: 18 },
        },
        {
          id: "gdd-stretch",
          name: "二阶展宽",
          tag: "STRETCH",
          description: "只打开 GDD，让频率分量以不同斜率错位。",
          params: { gdd: 360, chirp: 0, tod: 0, pulseWidth: 18 },
        },
        {
          id: "tod-asymmetry",
          name: "三阶畸变",
          tag: "ASYMMETRY",
          description: "加入 TOD，把对称高斯变成带拖尾的非对称包络。",
          params: { gdd: 220, chirp: 0, tod: 1200, pulseWidth: 18 },
        },
        {
          id: "compensation",
          name: "补偿临界",
          tag: "COMPENSATE",
          description: "初始啁啾与负 GDD 对冲，观察剩余相位是否能被拉回。",
          params: { gdd: -280, chirp: 1.55, tod: 0, pulseWidth: 18 },
        },
      ],
      compute: computePulseDispersion,
      views: [
        {
          id: "time",
          label: "时域包络",
          type: "2D_Plot",
          baseline: "初始高斯脉冲：灰色虚线，固定不动",
          current: "当前输出强度：青绿色发光曲线",
          annotation: "FWHM / 峰值 / 展宽倍率",
        },
        {
          id: "frequency",
          label: "频域相位",
          type: "2D_Plot",
          baseline: "归一化频谱：灰色虚线",
          current: "输出频谱与相位：紫蓝色曲线",
          annotation: "频率重排与三次相位偏斜",
        },
      ],
      metrics: [
        { key: "fwhm", label: "FWHM", unit: "fs", digits: 1 },
        { key: "broadening", label: "展宽倍率", unit: "×", digits: 2 },
        { key: "peak", label: "峰值", unit: "", digits: 2 },
      ],
      presetGlow: "rgba(124,247,212,.22)",
    },
    oscillator: {
      id: "oscillator",
      index: "02",
      name: "阻尼谐振子",
      shortName: "QHO / RESPONSE",
      subtitle: "驱动、阻尼与共振之间",
      question: "当外力频率接近自然频率时，为什么小阻尼系统会把响应推到失控边缘？",
      goal: "通过改变驱动频率与阻尼，逐步分离瞬态响应和稳态共振，理解 Q 因子的物理含义。",
      equations: [
        "\\ddot{x}+2\\gamma\\omega_0\\dot{x}+\\omega_0^2x=A\\cos(\\omega_d t)",
        "Q=\\frac{\\omega_0}{2\\gamma}",
      ],
      algorithm:
        "用 RK4 以 0.006 s 步长积分二阶状态方程 [x, v]；保留 75% 后的尾部估计稳态振幅。",
      helpers: ["rk4", "linspace", "gaussian"],
      palette: ["#ffcf70", "#7cf7d4", "#8ea2ff"],
      controls: [
        {
          id: "omega0",
          symbol: "ω₀",
          label: "自然角频率",
          unit: "rad/s",
          min: 0.5,
          max: 2.4,
          step: 0.02,
          default: 1.15,
          effect: "改变系统固有节拍；与驱动频率接近时形成共振窗口。",
        },
        {
          id: "damping",
          symbol: "γ",
          label: "阻尼比",
          unit: "",
          min: 0.02,
          max: 1.2,
          step: 0.01,
          default: 0.18,
          effect: "增大阻尼会让峰值衰减更快、共振峰变低。",
        },
        {
          id: "driveFreq",
          symbol: "ω_d",
          label: "驱动频率",
          unit: "rad/s",
          min: 0.35,
          max: 2.8,
          step: 0.02,
          default: 1.05,
          effect: "扫过自然频率时，稳态振幅达到峰值并出现相位滞后。",
        },
        {
          id: "driveAmp",
          symbol: "A",
          label: "驱动力幅值",
          unit: "",
          min: 0.1,
          max: 1.2,
          step: 0.05,
          default: 0.36,
          effect: "成比例放大外部输入，同时放大共振区的响应。",
        },
      ],
      presets: [
        {
          id: "free",
          name: "自由振荡",
          tag: "TRANSIENT",
          description: "微弱驱动下，观察初始能量如何被阻尼吃掉。",
          params: { omega0: 1.15, damping: 0.18, driveFreq: 0.42, driveAmp: 0.1 },
        },
        {
          id: "resonance",
          name: "共振窗口",
          tag: "RESONANCE",
          description: "驱动频率贴近自然频率，Q 因子把响应推向峰值。",
          params: { omega0: 1.4, damping: 0.16, driveFreq: 1.4, driveAmp: 0.62 },
        },
        {
          id: "overdamped",
          name: "过阻尼",
          tag: "DAMPED",
          description: "阻尼耗散占主导，振荡节拍被压平。",
          params: { omega0: 0.8, damping: 1.0, driveFreq: 0.8, driveAmp: 0.7 },
        },
      ],
      compute: computeQuantumOscillator,
      views: [
        {
          id: "response",
          label: "响应轨迹",
          type: "2D_Plot",
          baseline: "无驱动小型振荡：灰色虚线",
          current: "真实二阶动力学：琥珀色实线",
          annotation: "Q 因子 / 阻尼比 / 稳态振幅",
        },
        {
          id: "resonance",
          label: "幅频响应",
          type: "2D_Plot",
          baseline: "归一化幅频曲线：灰色虚线",
          current: "当前阻尼下的共振峰：琥珀色曲线",
          annotation: "当前驱动频率在幅频曲线上的工作点",
        },
      ],
      metrics: [
        { key: "qualityFactor", label: "Q 因子", unit: "", digits: 1 },
        { key: "steadyAmplitude", label: "尾部振幅", unit: "", digits: 2 },
        { key: "resonantRatio", label: "ω_d / ω₀", unit: "×", digits: 2 },
      ],
      presetGlow: "rgba(255,207,112,.22)",
    },
    cnn: {
      id: "cnn",
      index: "03",
      name: "卷积感受野",
      shortName: "CNN / KERNEL",
      subtitle: "让局部操作显形",
      question: "卷积核到底在看什么？为什么一个 5×5 的窗口能改变整张特征图的性格？",
      goal: "在输入、卷积核与输出特征图三视图联动中，建立感受野、平滑尺度与激活强度的直觉。",
      equations: [
        "F(x,y)=\\sum_{i,j}K(i,j)\\,I(x+i,y+j)",
        "A(x,y)=\\max(0,\\,g\\cdot F(x,y))",
      ],
      algorithm:
        "生成 48×48 的合成图案；按 kernelSize 和 σ 构造归一化高斯核；执行二维离散卷积并做 ReLU 激活。",
      helpers: ["gaussian", "matMul", "linspace"],
      palette: ["#8ea2ff", "#7cf7d4", "#ffcf70"],
      controls: [
        {
          id: "kernelSize",
          symbol: "k",
          label: "卷积核尺寸",
          unit: "px",
          min: 3,
          max: 9,
          step: 2,
          default: 5,
          effect: "核越大，单个输出像素看到的输入邻域越大，边缘被更宽的窗口平均。",
        },
        {
          id: "sigma",
          symbol: "σ",
          label: "高斯核宽度",
          unit: "px",
          min: 0.35,
          max: 2.2,
          step: 0.05,
          default: 0.85,
          effect: "增大 σ 会压低中心权重，输出从边缘增强转为低频平滑。",
        },
        {
          id: "gain",
          symbol: "g",
          label: "激活增益",
          unit: "×",
          min: 0.1,
          max: 1.8,
          step: 0.05,
          default: 1,
          effect: "放大 ReLU 后的响应强度，让弱纹理变得可见或被噪声掩盖。",
        },
        {
          id: "stride",
          symbol: "s",
          label: "卷积步长",
          unit: "px",
          min: 1,
          max: 2,
          step: 1,
          default: 1,
          effect: "增大步长会降低输出分辨率，同时扩大单个输出特征的视野。",
        },
      ],
      presets: [
        {
          id: "edge",
          name: "边缘响应",
          tag: "LOCAL",
          description: "小核小 σ，保留细密纹理与局部边缘。",
          params: { kernelSize: 3, sigma: 0.55, gain: 1.25, stride: 1 },
        },
        {
          id: "receptive",
          name: "扩张感受野",
          tag: "WIDER",
          description: "更大卷积核与步长，让输出格子变粗但视野变宽。",
          params: { kernelSize: 9, sigma: 1.55, gain: 1.1, stride: 2 },
        },
        {
          id: "soft-focus",
          name: "低频柔焦",
          tag: "SMOOTH",
          description: "宽高斯核压低高频，输出变成一张柔和的特征图。",
          params: { kernelSize: 7, sigma: 2.1, gain: 0.8, stride: 1 },
        },
      ],
      compute: computeCnnReceptiveField,
      views: [
        {
          id: "triptych",
          label: "输入 / 核 / 激活",
          type: "Grid_Heatmap",
          baseline: "原始输入结构：左侧灰阶图",
          current: "激活特征图：右侧霓虹热图",
          annotation: "感受野尺寸与输出分辨率",
        },
      ],
      metrics: [
        { key: "receptiveField", label: "感受野", unit: "px", digits: 0 },
        { key: "outputSize", label: "输出尺寸", unit: "px", digits: 0 },
        { key: "activationFraction", label: "激活占比", unit: "%", digits: 1 },
      ],
      presetGlow: "rgba(142,162,255,.22)",
    },
    pendulum: {
      id: "pendulum",
      index: "04",
      name: "非线性单摆",
      shortName: "PENDULUM / NONLINEAR",
      subtitle: "小角度近似何时失效",
      question: "为什么摆角越大，单摆周期就越不服从你背下来的那个公式？",
      goal: "把真实 sin θ 动力学与线性近似叠在一起，观察振幅如何改变周期和能量。",
      equations: [
        "\\ddot{\\theta}+b\\dot{\\theta}+\\frac{g}{L}\\sin\\theta=0",
        "T_0=2\\pi\\sqrt{L/g}",
      ],
      algorithm:
        "RK4 积分非线性单摆，以 4 ms 步长运行 18 s；用小角度解析解作为固定参考基线。",
      helpers: ["rk4", "linspace"],
      palette: ["#ff9e8a", "#7cf7d4", "#8ea2ff"],
      controls: [
        {
          id: "length",
          symbol: "L",
          label: "摆长",
          unit: "m",
          min: 0.4,
          max: 3,
          step: 0.05,
          default: 1.2,
          effect: "增大摆长会降低自然频率，让每个来回耗用更长时间。",
        },
        {
          id: "theta0",
          symbol: "θ₀",
          label: "初始摆角",
          unit: "rad",
          min: 0.08,
          max: 2.6,
          step: 0.01,
          default: 1.05,
          effect: "摆角远离零点后，sin θ 的非线性开始使周期偏离小角度近似。",
        },
        {
          id: "damping",
          symbol: "b",
          label: "阻尼系数",
          unit: "s⁻¹",
          min: 0,
          max: 0.35,
          step: 0.005,
          default: 0.035,
          effect: "阻尼抬高能量耗散速率，振幅包络会逐渐收拢。",
        },
        {
          id: "initialVelocity",
          symbol: "ω₀",
          label: "初始角速度",
          unit: "rad/s",
          min: -2,
          max: 2,
          step: 0.05,
          default: 0,
          effect: "给系统注入瞬时角动量，改变轨迹相位和可达能量。",
        },
      ],
      presets: [
        {
          id: "small-angle",
          name: "小角度",
          tag: "LINEAR",
          description: "近似解与真实轨迹几乎重合，验证线性化边界。",
          params: {
            length: 1.2,
            theta0: 0.16,
            damping: 0.02,
            initialVelocity: 0,
          },
        },
        {
          id: "large-angle",
          name: "大角度偏离",
          tag: "NONLINEAR",
          description: "振幅逼近 2 rad，观察真实周期与线性基线的错位。",
          params: {
            length: 1.2,
            theta0: 2.2,
            damping: 0.01,
            initialVelocity: 0,
          },
        },
        {
          id: "kicked",
          name: "带初速度",
          tag: "KICK",
          description: "从平衡位置附近踢出一脚，让能量进入不同模式。",
          params: {
            length: 0.8,
            theta0: 0.4,
            damping: 0.015,
            initialVelocity: 1.35,
          },
        },
      ],
      compute: computePendulum,
      views: [
        {
          id: "trajectory",
          label: "角度轨迹",
          type: "2D_Plot",
          baseline: "小角度近似：灰色虚线",
          current: "非线性真实轨迹：珊瑚色实线",
          annotation: "真实周期与线性周期偏差",
        },
      ],
      metrics: [
        { key: "estimatedPeriod", label: "真实周期", unit: "s", digits: 2 },
        { key: "periodError", label: "周期偏差", unit: "%", digits: 1 },
        { key: "maxTheta", label: "最大摆角", unit: "rad", digits: 2 },
      ],
      presetGlow: "rgba(255,158,138,.22)",
    },
  };

  const list = Object.values(registry);
  const dynamicDomains = new Map();

  function getDomain(id) {
    const domain = registry[id] || dynamicDomains.get(id);
    if (!domain) throw new Error(`Unknown domain: ${id}`);
    return domain;
  }

  function listDomains() {
    return [...list, ...dynamicDomains.values()].map((domain) => ({
      id: domain.id,
      index: domain.index,
      name: domain.name,
      shortName: domain.shortName,
      subtitle: domain.subtitle,
      question: domain.question,
      palette: domain.palette,
      dynamic: Boolean(domain.dynamic),
    }));
  }

  function registerDynamicDomain(domain) {
    if (!domain?.id || !Array.isArray(domain.controls) || !Array.isArray(domain.presets)) {
      throw new Error("Dynamic domain requires id, controls and presets.");
    }
    registry[domain.id] = domain;
    dynamicDomains.set(domain.id, domain);
    return domain;
  }

  function unregisterDynamicDomain(id) {
    if (!dynamicDomains.has(id)) return false;
    dynamicDomains.delete(id);
    delete registry[id];
    return true;
  }

  return {
    compute: (domainId, params, options) => getDomain(domainId).compute(params, options),
    defaultParams,
    getDomain,
    listDomains,
    registerDynamicDomain,
    unregisterDynamicDomain,
    normalizeParams,
    presetParams,
    resolvePreset,
  };
});
