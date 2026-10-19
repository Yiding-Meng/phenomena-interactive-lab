const test = require("node:test");
const assert = require("node:assert/strict");

// src/chart-renderer.js 是一个 UMD 模块，运行时只依赖一个最小 DOM/Canvas 子集。
// 这里用记录型 2D 上下文替身替代浏览器，既能跑到绘制逻辑，又能断言坐标是否有限/越界。
globalThis.window = globalThis.window || { devicePixelRatio: 2 };
globalThis.document = globalThis.document || {
  createElement: () => makeCanvas(1, 1),
};

function makeCanvas(width = 900, height = 620) {
  const calls = { points: [], texts: [], rects: [] };
  const ctx = {
    canvas: null,
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "",
    lineCap: "",
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: "",
    textAlign: "",
    textBaseline: "",
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    clip() {},
    moveTo(x, y) {
      calls.points.push([x, y]);
    },
    lineTo(x, y) {
      calls.points.push([x, y]);
    },
    arc(x, y, r) {
      calls.points.push([x, y, r]);
    },
    rect(x, y, w, h) {
      calls.rects.push([x, y, w, h]);
    },
    fillRect(x, y, w, h) {
      calls.rects.push([x, y, w, h]);
    },
    strokeRect(x, y, w, h) {
      calls.rects.push([x, y, w, h]);
    },
    translate() {},
    rotate() {},
    stroke() {},
    fill() {},
    setLineDash() {},
    measureText(text) {
      return { width: String(text).length * 6 };
    },
    fillText(text, x, y) {
      calls.texts.push({ text: String(text), x, y });
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    drawImage() {},
    getImageData() {
      return { data: new Uint8ClampedArray(4) };
    },
  };
  const canvas = {
    width: 1,
    height: 1,
    style: {},
    parentElement: { clientWidth: width, clientHeight: height },
    getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }),
    getContext: () => ctx,
    addEventListener() {},
    removeEventListener() {},
    __calls: calls,
  };
  ctx.canvas = canvas;
  return canvas;
}

const Chart = require("../src/chart-renderer.js");
const Domains = require("../src/domains.js");

function assertFiniteDrawing(canvas, label) {
  for (const [x, y, ...rest] of canvas.__calls.points) {
    assert.ok(
      Number.isFinite(x) && Number.isFinite(y),
      `${label}: 路径坐标出现非有限值 (${x}, ${y})`,
    );
    assert.ok(
      rest.every((value) => Number.isFinite(value)),
      `${label}: 半径出现非有限值`,
    );
  }
  for (const [x, y, w, h] of canvas.__calls.rects) {
    assert.ok(
      [x, y, w, h].every((value) => Number.isFinite(value)),
      `${label}: 矩形出现非有限值 (${x}, ${y}, ${w}, ${h})`,
    );
    assert.ok(w >= 0 && h >= 0, `${label}: 矩形出现负尺寸 (${w}, ${h})`);
  }
  for (const item of canvas.__calls.texts) {
    assert.ok(
      Number.isFinite(item.x) && Number.isFinite(item.y),
      `${label}: 文本坐标非有限 "${item.text}" (${item.x}, ${item.y})`,
    );
    assert.ok(
      !/\$/.test(item.text),
      `${label}: 画布上出现未渲染的 LaTeX 源码 "${item.text}"`,
    );
  }
}

test("exports keep the original API and add the new primitives", () => {
  for (const name of [
    "renderPlot",
    "renderTriptych",
    "renderPhasePortrait",
    "canvasHash",
    "canvasMse",
    "niceTicks",
    "formatTick",
  ]) {
    assert.equal(typeof Chart[name], "function", `${name} 必须保留`);
  }
  for (const name of [
    "renderGridWithProbe",
    "renderPhaseSpaceTrajectory",
    "computeGridProbe",
    "computePhaseTrajectory",
    "gridLayout",
  ]) {
    assert.equal(typeof Chart[name], "function", `${name} 必须新增`);
  }
});

const cnnDomain = Domains.getDomain("cnn");

test("Grid_Tensor_View: 探针使用真实卷积数值，不是伪造数据", () => {
  const result = Domains.compute("cnn", { kernelSize: 3, sigma: 0.55, gain: 1.25, stride: 1 });
  const probe = Chart.computeGridProbe(result, 20, 24);

  const kernelSize = result.kernel.length;
  assert.equal(probe.patch.length, kernelSize);
  assert.equal(probe.kernel.length, kernelSize);

  // 逐点积之和必须等于该输出单元的预激活值（gain 之前）
  const manual = probe.products.flat().reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(manual - probe.preActivation) < 1e-12);
  assert.ok(Math.abs(probe.gained - probe.preActivation * result.params.gain) < 1e-12);
  assert.equal(probe.relu, Math.max(0, probe.gained));
  assert.ok(probe.finite);

  // 输出值必须能与 result 数组对齐（归一化后）
  const peak = result.metrics.maxActivation;
  assert.ok(
    Math.abs(probe.outputValue - result.activation[20][24]) < 1e-12,
    "探针输出值必须等于真实激活数组中的值",
  );
  assert.ok(peak > 0);
});

test("Grid_Tensor_View: 边缘、stride>1、极端核尺寸都不产生 NaN", () => {
  for (const kernelSize of [3, 7, 15]) {
    for (const stride of [1, 2, 3]) {
      const result = Domains.compute("cnn", {
        kernelSize,
        sigma: 0.4 + kernelSize / 12,
        gain: 1.8,
        stride,
      });
      const size = result.activation.length;
      for (const [row, column] of [
        [0, 0],
        [0, size - 1],
        [size - 1, 0],
        [size - 1, size - 1],
        [Math.floor(size / 2), Math.floor(size / 2)],
      ]) {
        const probe = Chart.computeGridProbe(result, row, column);
        assert.ok(probe.finite, `k=${kernelSize} stride=${stride} (${row},${column}) 出现 NaN`);
        assert.ok(Number.isFinite(probe.outputValue));
        assert.ok(probe.products.every((line) => line.every(Number.isFinite)));
      }
    }
  }
});

test("Grid_Tensor_View: hover 落点被钳制在合法格子里", () => {
  const result = Domains.compute("cnn", { kernelSize: 5, sigma: 1.1, gain: 1, stride: 2 });
  const layout = Chart.gridLayout(900, 620, {
    cellCounts: {
      input: result.image.length,
      kernel: result.kernel.length,
      activation: result.activation.length,
    },
  }, result);

  const outside = layout.hitTest(layout.panels.input.x - 40, layout.panels.input.y - 40);
  assert.equal(outside, null);

  const center = layout.hitTest(
    layout.panels.activation.x + layout.panels.activation.size / 2,
    layout.panels.activation.y + layout.panels.activation.size / 2,
  );
  assert.equal(center.panel, "activation");
  assert.ok(center.row >= 0 && center.row < result.activation.length);
  assert.ok(center.column >= 0 && center.column < result.activation.length);

  const corner = layout.hitTest(
    layout.panels.activation.x + layout.panels.activation.size + 5,
    layout.panels.activation.y + layout.panels.activation.size + 5,
  );
  assert.equal(corner, null);
});

test("Grid_Tensor_View: 绘制出的探针层不越界且无 LaTeX 乱码", () => {
  const canvas = makeCanvas(900, 620);
  const result = Domains.compute("cnn", { kernelSize: 9, sigma: 1.55, gain: 1.1, stride: 2 });
  const output = Chart.renderGridWithProbe(canvas, result, {
    width: 900,
    height: 620,
    dpr: 2,
    interactive: false,
  });

  assert.ok(output.layout);
  assert.equal(output.probe, null, "未 hover 时不应凭空产生探针");
  assert.ok(canvas.__calls.texts.length > 0);
  assertFiniteDrawing(canvas, "renderGridWithProbe/无探针");

  // 探针带必须留在画布内部，且不与三联图重叠
  const band = output.layout.band;
  assert.ok(band.y >= output.layout.panels.input.y + output.layout.imageSize);
  assert.ok(band.y + band.height <= 620 + 1e-6, "探针带越出画布底部");
  assert.ok(band.x >= 0 && band.x + band.width <= 900 + 1e-6);
});

test("Grid_Tensor_View: 三种面板的探针都能绘制且坐标有限", () => {
  const result = Domains.compute("cnn", { kernelSize: 3, sigma: 0.55, gain: 1.25, stride: 1 });
  const probes = [
    { panel: "input", row: 10, column: 12 },
    { panel: "kernel", row: 1, column: 1 },
    { panel: "activation", row: 6, column: 8 },
  ];
  for (const probe of probes) {
    const canvas = makeCanvas(1120, 700);
    const output = Chart.renderGridWithProbe(canvas, result, {
      width: 1120,
      height: 700,
      dpr: 2,
      interactive: false,
      probe,
    });
    assert.ok(output.probe, `${probe.panel} 探针未生成`);
    assert.equal(output.probe.panel, probe.panel === "kernel" ? "kernel" : "grid");
    assertFiniteDrawing(canvas, `renderGridWithProbe/${probe.panel}`);
  }
});

test("Grid_Tensor_View: 窄画布下自动收缩，不产生负尺寸", () => {
  const canvas = makeCanvas(360, 260);
  const result = Domains.compute("cnn", { kernelSize: 3, sigma: 0.6, gain: 1, stride: 1 });
  const output = Chart.renderGridWithProbe(canvas, result, {
    width: 360,
    height: 260,
    dpr: 1,
    interactive: false,
    probe: { panel: "activation", row: 4, column: 4 },
  });
  assert.ok(output.layout.imageSize > 0);
  assert.ok(output.layout.band.y + output.layout.band.height <= 260 + 1e-6);
  assertFiniteDrawing(canvas, "renderGridWithProbe/窄画布");
});

test("相空间轨迹：起终点、箭头与真实 RK4 序列一致", () => {
  const result = Domains.compute("pendulum", Domains.defaultParams(Domains.getDomain("pendulum")));
  const model = Chart.computePhaseTrajectory(result);

  assert.ok(model.finite);
  assert.equal(model.points.length, result.series.current.length);
  assert.ok(model.arrows.length >= 2, "必须绘制方向箭头");
  assert.equal(model.start.x, result.series.current[0]);
  assert.equal(model.start.y, result.series.velocity[0]);
  assert.equal(model.end.x, result.series.current.at(-1));
  assert.equal(model.end.y, result.series.velocity.at(-1));
  assert.ok(model.start.time < model.end.time);
  assert.ok(model.domain[0] < 0 && model.domain[1] > 0);
  assert.ok(model.baseline.length > 1, "必须保留小角度参考基线");
});

test("相空间轨迹：oscillator 与 pendulum 都能绘制且坐标有限", () => {
  for (const domainId of ["pendulum", "oscillator"]) {
    for (const preset of Domains.getDomain(domainId).presets) {
      const canvas = makeCanvas(760, 460);
      const result = Domains.compute(domainId, preset.params);
      const output = Chart.renderPhaseSpaceTrajectory(canvas, result, {
        width: 760,
        height: 460,
        dpr: 2,
      });
      assert.ok(output.model.points.length > 1);
      assert.ok(
        output.model.arrows.length >= 2,
        `${domainId}/${preset.id} 缺少方向箭头`,
      );
      assert.ok(output.bounds.right > output.bounds.left);
      assertFiniteDrawing(canvas, `renderPhaseSpaceTrajectory/${domainId}/${preset.id}`);
      const labels = canvas.__calls.texts.map((item) => item.text);
      assert.ok(labels.some((text) => text.startsWith("起点")), "缺少起点标记");
      assert.ok(labels.some((text) => text.startsWith("终点")), "缺少终点标记");
    }
  }
});

test("相空间轨迹：极端参数下不出现 NaN 或坍缩成一点", () => {
  for (const domainId of ["pendulum", "oscillator"]) {
    const controls = Domains.getDomain(domainId).controls;
    const extremes = [
      Object.fromEntries(controls.map((control) => [control.id, control.min])),
      Object.fromEntries(controls.map((control) => [control.id, control.max])),
    ];
    for (const params of extremes) {
      const canvas = makeCanvas(700, 420);
      const result = Domains.compute(domainId, params);
      const output = Chart.renderPhaseSpaceTrajectory(canvas, result, {
        width: 700,
        height: 420,
        dpr: 1,
      });
      assert.ok(
        output.model.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
        `${domainId} 极端参数出现 NaN`,
      );
      assert.ok(output.xDomain[1] > output.xDomain[0], "相空间 x 轴坍缩");
      assert.ok(output.yDomain[1] > output.yDomain[0], "相空间 y 轴坍缩");
      assertFiniteDrawing(canvas, `renderPhaseSpaceTrajectory/${domainId}/极端`);
    }
  }
});

test("相空间轨迹：markerTime 定位到最近的时间点", () => {
  const result = Domains.compute("pendulum", Domains.defaultParams(Domains.getDomain("pendulum")));
  const model = Chart.computePhaseTrajectory(result, { markerTime: 4 });
  assert.ok(model.marker);
  assert.ok(Math.abs(model.marker.time - 4) < 0.05);
});

test("既有 API 未被破坏：renderPhasePortrait 仍可用", () => {
  const canvas = makeCanvas(640, 400);
  const result = Domains.compute("pendulum", Domains.defaultParams(Domains.getDomain("pendulum")));
  const output = Chart.renderPhasePortrait(canvas, result, { width: 640, height: 400, dpr: 1 });
  assert.ok(output.bounds);
  assert.ok(canvas.__calls.points.length > 0);
  assertFiniteDrawing(canvas, "renderPhasePortrait");
});

test("既有 API 未被破坏：renderPlot 与 renderTriptych 仍可用", () => {
  const plotCanvas = makeCanvas(700, 420);
  const pulse = Domains.compute("pulse", Domains.defaultParams(Domains.getDomain("pulse")));
  Chart.renderPlot(plotCanvas, {
    width: 700,
    height: 420,
    dpr: 1,
    series: [{ values: pulse.series.current, color: "#7cf7d4" }],
    xDomain: pulse.axes.xRange,
    yDomain: pulse.axes.yRange,
  });
  assert.ok(plotCanvas.__calls.points.length > 0);
  assertFiniteDrawing(plotCanvas, "renderPlot");

  const cnnCanvas = makeCanvas(900, 620);
  const cnn = Domains.compute("cnn", Domains.defaultParams(Domains.getDomain("cnn")));
  Chart.renderTriptych(cnnCanvas, cnn, { width: 900, height: 620, dpr: 1 });
  assertFiniteDrawing(cnnCanvas, "renderTriptych");
});

test("cnn 控制边界仍然是合法的可绘制区间", () => {
  for (const control of cnnDomain.controls) {
    assert.ok(control.min < control.max);
  }
});
