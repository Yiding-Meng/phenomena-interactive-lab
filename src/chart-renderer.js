(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PhenomenaChart = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FONT_BODY = '"Avenir Next", "PingFang SC", "Helvetica Neue", sans-serif';
  const FONT_MONO = '"SFMono-Regular", "Menlo", "Monaco", monospace';
  const INK = "#dce9e3";
  const MUTED = "#789088";
  const GRID = "rgba(196, 231, 218, 0.095)";
  const AXIS = "rgba(196, 231, 218, 0.22)";

  // 探针层配色（Grid_Tensor_View 使用）与相空间轨迹配色（Vector_Physics_2D 使用）
  const PROBE_ACCENT = "#7cf7d4";
  const PROBE_INPUT = "#cbe9ff";
  const PROBE_KERNEL = "#8fa8ff";
  const PROBE_OUTPUT = "#ffd37a";
  const TRAJECTORY_START = "#6ff2d0";
  const TRAJECTORY_END = "#ff9e8a";
  const INPUT_COLORS = [
    [0, [7, 17, 22]],
    [0.45, [24, 62, 73]],
    [0.75, [115, 205, 192]],
    [1, [245, 245, 219]],
  ];
  const KERNEL_COLORS = [
    [0, [11, 24, 38]],
    [0.35, [29, 50, 85]],
    [0.7, [111, 139, 255]],
    [1, [218, 232, 255]],
  ];
  const ACTIVATION_COLORS = [
    [0, [8, 16, 21]],
    [0.2, [23, 53, 64]],
    [0.55, [111, 229, 204]],
    [0.82, [202, 255, 229]],
    [1, [255, 211, 125]],
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function trimNumber(value, digits = 2) {
    if (!Number.isFinite(value)) return "--";
    const text = value.toFixed(digits);
    if (text.startsWith("0.")) return text.slice(1);
    if (text.startsWith("-0.")) return `-${text.slice(2)}`;
    return text;
  }

  function hexToRgb(hex) {
    const normalized = hex.replace("#", "");
    const full =
      normalized.length === 3
        ? normalized
            .split("")
            .map((char) => char + char)
            .join("")
        : normalized;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }

  function mixHex(fromHex, toHex, t) {
    const from = hexToRgb(fromHex);
    const to = hexToRgb(toHex);
    const ratio = clamp(t, 0, 1);
    return `rgb(${from
      .map((channel, index) => Math.round(channel + (to[index] - channel) * ratio))
      .join(",")})`;
  }

  function niceTicks(min, max, count = 5) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return [min];
    }
    if (min > max) [min, max] = [max, min];
    if (min === max) return [min];
    const rawStep = (max - min) / count;
    const magnitude = 10 ** Math.floor(Math.log10(Math.abs(rawStep)));
    const normalized = rawStep / magnitude;
    const nice = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
    const step = nice * magnitude;
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let value = start; value <= max + step * 1e-8; value += step) {
      ticks.push(Math.abs(value) < step * 1e-8 ? 0 : value);
    }
    return ticks;
  }

  function formatTick(value) {
    if (value === 0) return "0";
    const absolute = Math.abs(value);
    if (absolute >= 1000 || absolute < 0.01) return value.toExponential(1);
    if (absolute >= 10) return value.toFixed(0);
    if (absolute >= 1) return Number(value.toFixed(1)).toString();
    return Number(value.toFixed(2)).toString();
  }

  function setupCanvas(canvas, config) {
    const dpr = config.dpr || window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = config.width || rect.width || canvas.parentElement?.clientWidth || 720;
    const height =
      config.height || rect.height || canvas.parentElement?.clientHeight || 420;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    if (!canvas.style.width) canvas.style.width = `${width}px`;
    if (!canvas.style.height) canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d", { alpha: true });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height, dpr };
  }

  function resolvePlotBounds(config) {
    const hasRightAxis =
      config.rightAxis ||
      config.series.some((series) => series.axis === "right");
    return {
      left: config.padding?.left || 58,
      right: config.width - (config.padding?.right || (hasRightAxis ? 62 : 22)),
      top: config.padding?.top || 22,
      bottom: config.height - (config.padding?.bottom || 56),
    };
  }

  function getDomain(config, axis) {
    if (axis === "right" && config.rightAxis) return config.rightAxis;
    if (config.yDomain) return config.yDomain;
    let min = Infinity;
    let max = -Infinity;
    for (const series of config.series) {
      if ((series.axis || "left") !== axis) continue;
      for (const value of series.values) {
        if (value === null) continue;
        if (!Number.isFinite(value)) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
    if (min === max) {
      const pad = Math.abs(min) * 0.1 || 1;
      return [min - pad, max + pad];
    }
    const pad = (max - min) * 0.08;
    return [min - pad, max + pad];
  }

  function makeScale(domain, range) {
    let [d0, d1] = domain;
    if (d0 > d1) [d0, d1] = [d1, d0];
    const [r0, r1] = range;
    return (value) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);
  }

  function drawGrid(ctx, bounds, config) {
    const xTicks = niceTicks(
      config.xDomain[0],
      config.xDomain[1],
      config.xTickCount || 6,
    ).filter((tick) => Math.abs(tick) > 0 || config.xDomain[0] <= 0);
    const yTicks = niceTicks(config.yDomainResolved[0], config.yDomainResolved[1], 5);
    const mapX = makeScale(config.xDomain, [bounds.left, bounds.right]);
    const mapY = makeScale(config.yDomainResolved, [bounds.bottom, bounds.top]);

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = GRID;
    ctx.fillStyle = MUTED;
    ctx.font = `10px ${FONT_MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (const tick of xTicks) {
      const x = mapX(tick);
      if (x < bounds.left - 1 || x > bounds.right + 1) continue;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, bounds.top);
      ctx.lineTo(Math.round(x) + 0.5, bounds.bottom);
      ctx.stroke();
      ctx.fillText(formatTick(tick), x, bounds.bottom + 12);
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const tick of yTicks) {
      const y = mapY(tick);
      if (y < bounds.top - 1 || y > bounds.bottom + 1) continue;
      ctx.beginPath();
      ctx.moveTo(bounds.left, Math.round(y) + 0.5);
      ctx.lineTo(bounds.right, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillText(formatTick(tick), bounds.left - 11, y);
    }

    if (config.rightAxis) {
      const rightTicks = niceTicks(
        config.rightAxis[0],
        config.rightAxis[1],
        5,
      );
      const rightMap = makeScale(config.rightAxis, [bounds.bottom, bounds.top]);
      ctx.textAlign = "left";
      for (const tick of rightTicks) {
        const y = rightMap(tick);
        if (y < bounds.top - 1 || y > bounds.bottom + 1) continue;
        ctx.fillText(formatTick(tick), bounds.right + 11, y);
      }
    }

    ctx.strokeStyle = AXIS;
    ctx.beginPath();
    ctx.moveTo(bounds.left, bounds.top);
    ctx.lineTo(bounds.left, bounds.bottom);
    ctx.lineTo(bounds.right, bounds.bottom);
    ctx.stroke();
    ctx.restore();
  }

  function drawAxisLabels(ctx, bounds, config) {
    ctx.save();
    ctx.fillStyle = MUTED;
    ctx.font = `11px ${FONT_BODY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    if (config.xLabel) {
      ctx.fillText(config.xLabel, (bounds.left + bounds.right) / 2, config.height - 7);
    }
    ctx.translate(16, (bounds.top + bounds.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    if (config.yLabel) ctx.fillText(config.yLabel, 0, 0);
    ctx.restore();

    if (config.rightLabel) {
      ctx.save();
      ctx.fillStyle = MUTED;
      ctx.font = `10px ${FONT_BODY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.translate(config.width - 9, (bounds.top + bounds.bottom) / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(config.rightLabel, 0, 0);
      ctx.restore();
    }
  }

  function linePath(ctx, points, mapX, mapY) {
    ctx.beginPath();
    let started = false;
    for (const point of points) {
      if (
        point.y === null ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
      ) {
        started = false;
        continue;
      }
      const x = mapX(point.x);
      const y = mapY(point.y);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
  }

  function drawText(ctx, text, x, y, options = {}) {
    const paddingX = options.paddingX ?? 6;
    const paddingY = options.paddingY ?? 4;
    ctx.save();
    ctx.font = `${options.size || 9}px ${options.mono ? FONT_MONO : FONT_BODY}`;
    const width = ctx.measureText(text).width;
    ctx.fillStyle = options.background || "rgba(6,16,13,.82)";
    ctx.fillRect(
      x - paddingX,
      y - paddingY - (options.size || 9),
      width + paddingX * 2,
      (options.size || 9) + paddingY * 2,
    );
    ctx.fillStyle = options.color || INK;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function renderPlot(canvas, config) {
    const setup = setupCanvas(canvas, config);
    const { ctx, width, height } = setup;
    const sizedConfig = { ...config, width, height };
    const bounds = resolvePlotBounds(sizedConfig);
    const xDomain = config.xDomain || [0, config.series[0].values.length - 1];
    const yDomainResolved = getDomain(sizedConfig, "left");
    const rightDomain = config.rightAxis || getDomain(sizedConfig, "right");
    const effective = {
      ...sizedConfig,
      xDomain,
      yDomainResolved,
      rightAxis: rightDomain,
    };

    drawGrid(ctx, bounds, effective);
    drawAxisLabels(ctx, bounds, effective);

    const mapX = makeScale(xDomain, [bounds.left, bounds.right]);
    const mapYLeft = makeScale(yDomainResolved, [bounds.bottom, bounds.top]);
    const mapYRight = rightDomain
      ? makeScale(rightDomain, [bounds.bottom, bounds.top])
      : mapYLeft;

    ctx.save();
    ctx.beginPath();
    ctx.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    ctx.clip();

    for (const series of config.series) {
      const values = series.values;
      if (!values?.length) continue;
      const seriesX =
        series.x ||
        Array.from({ length: values.length }, (_, index) =>
          values.length === 1 ? xDomain[0] : xDomain[0] + ((xDomain[1] - xDomain[0]) * index) / (values.length - 1),
        );
      const points = values.map((value, index) => ({
        x: seriesX[index],
        y: value,
      }));
      const mapY = series.axis === "right" ? mapYRight : mapYLeft;

      if (series.fill) {
        const fillPath = new Path2D();
        let started = false;
        for (const point of points) {
          if (
            point.y === null ||
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y)
          ) {
            continue;
          }
          const x = mapX(point.x);
          const y = mapY(point.y);
          if (!started) {
            fillPath.moveTo(x, bounds.bottom);
            fillPath.lineTo(x, y);
            started = true;
          } else {
            fillPath.lineTo(x, y);
          }
        }
        if (started) {
          fillPath.lineTo(mapX(points.at(-1).x), bounds.bottom);
          fillPath.closePath();
          const gradient = ctx.createLinearGradient(0, bounds.top, 0, bounds.bottom);
          gradient.addColorStop(0, series.fill);
          gradient.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = gradient;
          ctx.fill(fillPath);
        }
      }

      linePath(ctx, points, mapX, mapY);
      ctx.strokeStyle = series.color || INK;
      ctx.lineWidth = series.width || 1.6;
      ctx.globalAlpha = series.alpha ?? 1;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (series.dash) ctx.setLineDash(series.dash);
      if (series.glow) {
        ctx.shadowColor = series.glow;
        ctx.shadowBlur = series.glowBlur || 13;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    if (config.marker?.x !== undefined) {
      const x = mapX(config.marker.x);
      if (x >= bounds.left && x <= bounds.right) {
        ctx.strokeStyle = config.marker.color || "rgba(255,255,255,.38)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.moveTo(x, bounds.top);
        ctx.lineTo(x, bounds.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = config.marker.color || INK;
        ctx.beginPath();
        ctx.arc(x, bounds.top + 8, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    if (config.callout) {
      const x = mapX(config.callout.x);
      const y = mapYLeft(config.callout.y);
      const clampedX = Math.min(bounds.right - 92, Math.max(bounds.left + 8, x));
      const clampedY = Math.min(bounds.bottom - 12, Math.max(bounds.top + 24, y - 14));
      drawText(ctx, config.callout.text, clampedX, clampedY, {
        color: config.callout.color || INK,
        mono: true,
        size: 9,
      });
    }
    return { bounds, xDomain, yDomain: yDomainResolved };
  }

  function colorFor(value, stops) {
    const clamped = Math.min(1, Math.max(0, value));
    const anchors = stops || [
      [0, [9, 18, 24]],
      [0.3, [26, 68, 77]],
      [0.58, [91, 203, 187]],
      [0.8, [178, 251, 219]],
      [1, [255, 250, 220]],
    ];
    for (let index = 1; index < anchors.length; index += 1) {
      const [position, color] = anchors[index];
      const [previousPosition, previousColor] = anchors[index - 1];
      if (clamped <= position) {
        const t = (clamped - previousPosition) / (position - previousPosition);
        return `rgb(${previousColor
          .map((channel, channelIndex) =>
            Math.round(channel + (color[channelIndex] - channel) * t),
          )
          .join(",")})`;
      }
    }
    return `rgb(${anchors.at(-1)[1].join(",")})`;
  }

  function renderMatrix(ctx, matrix, x, y, width, height, options = {}) {
    const rows = matrix.length;
    const columns = matrix[0].length;
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    let min = options.min ?? Infinity;
    let max = options.max ?? -Infinity;
    if (options.min === undefined || options.max === undefined) {
      for (const row of matrix) {
        for (const value of row) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
    }
    const range = max - min || 1;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const normalized = (matrix[row][column] - min) / range;
        ctx.fillStyle = colorFor(normalized, options.colors);
        ctx.fillRect(
          x + column * cellWidth,
          y + row * cellHeight,
          Math.ceil(cellWidth + 0.5),
          Math.ceil(cellHeight + 0.5),
        );
      }
    }

    if (options.showValues && Math.min(cellWidth, cellHeight) >= 13) {
      const size = clamp(Math.min(cellWidth, cellHeight) * 0.32, 7, 10);
      ctx.save();
      ctx.font = `${size}px ${FONT_MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const normalized = (matrix[row][column] - min) / range;
          ctx.fillStyle = normalized > 0.55 ? "rgba(6,20,17,.86)" : "rgba(226,242,236,.92)";
          ctx.fillText(
            trimNumber(matrix[row][column], options.digits ?? 2),
            x + (column + 0.5) * cellWidth,
            y + (row + 0.5) * cellHeight,
          );
        }
      }
      ctx.restore();
    }

    if (options.border) {
      ctx.strokeStyle = options.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    }
  }

  function label(ctx, text, x, y, options = {}) {
    ctx.save();
    ctx.fillStyle = options.color || MUTED;
    ctx.font = `${options.size || 10}px ${options.mono ? FONT_MONO : FONT_BODY}`;
    ctx.textAlign = options.align || "left";
    ctx.textBaseline = options.baseline || "top";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function renderTriptych(canvas, result, config = {}) {
    const setup = setupCanvas(canvas, config);
    const { ctx, width, height } = setup;
    const gap = Math.max(14, width * 0.025);
    const outer = 16;
    const labelHeight = 36;
    const unit = width / 3.08;
    const imageSize = Math.min(unit, height - labelHeight - outer * 2);
    const totalWidth = imageSize * 3 + gap * 2;
    const startX = (width - totalWidth) / 2;
    const startY = outer + labelHeight;

    label(ctx, "INPUT / 输入", startX, 15, { color: INK, size: 11 });
    label(ctx, `${result.image.length} × ${result.image.length}`, startX + imageSize, 16, {
      align: "right",
      mono: true,
      size: 9,
    });

    renderMatrix(ctx, result.image, startX, startY, imageSize, imageSize, {
      min: 0,
      max: 1,
      border: "rgba(196,231,218,.18)",
      colors: [
        [0, [7, 17, 22]],
        [0.45, [24, 62, 73]],
        [0.75, [115, 205, 192]],
        [1, [245, 245, 219]],
      ],
    });

    const kernelX = startX + imageSize + gap;
    label(ctx, "KERNEL / 卷积核", kernelX, 15, { color: INK, size: 11 });
    label(ctx, `${result.kernel.length} × ${result.kernel.length}`, kernelX + imageSize, 16, {
      align: "right",
      mono: true,
      size: 9,
    });
    renderMatrix(ctx, result.kernel, kernelX, startY, imageSize, imageSize, {
      border: "rgba(196,231,218,.18)",
      colors: [
        [0, [11, 24, 38]],
        [0.35, [29, 50, 85]],
        [0.7, [111, 139, 255]],
        [1, [218, 232, 255]],
      ],
    });

    const activationX = startX + (imageSize + gap) * 2;
    label(ctx, "ACTIVATION / 激活", activationX, 15, { color: INK, size: 11 });
    label(
      ctx,
      `${result.activation.length} × ${result.activation.length}`,
      activationX + imageSize,
      16,
      { align: "right", mono: true, size: 9 },
    );
    renderMatrix(ctx, result.activation, activationX, startY, imageSize, imageSize, {
      min: 0,
      max: Math.max(1, result.metrics.maxActivation),
      border: "rgba(196,231,218,.18)",
      colors: [
        [0, [8, 16, 21]],
        [0.2, [23, 53, 64]],
        [0.55, [111, 229, 204]],
        [0.82, [202, 255, 229]],
        [1, [255, 211, 125]],
      ],
    });
    return { width, height };
  }

  function renderPhasePortrait(canvas, result, config = {}) {
    const theta = result.series.current;
    const omega = result.series.velocity;
    const baselineTheta = result.series.baseline;
    const baselineOmega = result.series.baselineVelocity;
    const maxTheta = Math.max(Math.PI * 0.55, ...theta.map(Math.abs)) * 1.08;
    const maxOmega = Math.max(1.4, ...omega.map(Math.abs)) * 1.08;
    return renderPlot(canvas, {
      ...config,
      xDomain: [-maxTheta, maxTheta],
      yDomain: [-maxOmega, maxOmega],
      series: [
        {
          x: baselineTheta,
          values: baselineOmega,
          color: "#71847e",
          width: 1.2,
          dash: [5, 5],
          alpha: 0.68,
        },
        {
          x: theta,
          values: omega,
          color: "#ff9e8a",
          width: 1.8,
          glow: "rgba(255,158,138,.38)",
        },
      ],
      xLabel: result.axes.yLabel,
      yLabel: "角速度 dθ/dt (rad/s)",
    });
  }

  /* ------------------------------------------------------------------ *
   * Grid_Tensor_View：二维张量 / 网格热力图 + 悬停探针
   * ------------------------------------------------------------------ */

  function finiteExtent(values, fallback = 0) {
    let max = 0;
    for (const value of values) {
      if (Number.isFinite(value)) max = Math.max(max, Math.abs(value));
    }
    return max || fallback;
  }

  // 用真实数组重算某一个输出像素的局部卷积：与 domains.convolve2d 完全同一套取样规则（越界补零）
  function computeGridProbe(result, outputRow, outputColumn) {
    const image = result?.image;
    const kernel = result?.kernel;
    const activation = result?.activation;
    if (!image?.length || !kernel?.length || !activation?.length) return null;

    const imageSize = image.length;
    const kernelSize = kernel.length;
    const outputSize = activation.length;
    const stride = Math.max(1, Math.round(result.params?.stride ?? 1));
    const gain = Number.isFinite(result.params?.gain) ? result.params.gain : 1;
    const row = clamp(Math.round(outputRow), 0, outputSize - 1);
    const column = clamp(Math.round(outputColumn), 0, outputSize - 1);
    const half = Math.floor(kernelSize / 2);
    const centerRow = row * stride;
    const centerColumn = column * stride;

    const patch = [];
    const products = [];
    let sum = 0;
    for (let ky = 0; ky < kernelSize; ky += 1) {
      const patchRow = [];
      const productRow = [];
      for (let kx = 0; kx < kernelSize; kx += 1) {
        const sourceRow = centerRow + ky - half;
        const sourceColumn = centerColumn + kx - half;
        const inside =
          sourceRow >= 0 &&
          sourceRow < imageSize &&
          sourceColumn >= 0 &&
          sourceColumn < imageSize;
        const sampled = inside ? image[sourceRow][sourceColumn] : 0;
        const product = sampled * kernel[ky][kx];
        patchRow.push(sampled);
        productRow.push(product);
        sum += product;
      }
      patch.push(patchRow);
      products.push(productRow);
    }

    const gained = sum * gain;
    const relu = Math.max(0, gained);
    const outputValue = activation[row]?.[column] ?? 0;
    return {
      panel: "grid",
      outputRow: row,
      outputColumn: column,
      inputRow: centerRow,
      inputColumn: centerColumn,
      inputValue: image[centerRow]?.[centerColumn] ?? 0,
      outputValue,
      stride,
      gain,
      kernelSize,
      imageSize,
      outputSize,
      patch,
      products,
      kernel,
      preActivation: sum,
      gained,
      relu,
      clipped: relu === 0 && gained < 0,
      receptiveRect: {
        top: centerRow - half,
        left: centerColumn - half,
        size: kernelSize,
      },
      finite: [sum, gained, relu, outputValue].every((value) =>
        Number.isFinite(value),
      ),
    };
  }

  // 把「鼠标落在哪个面板的哪个格子」翻译成探针模型
  function resolveGridProbe(result, hover) {
    if (!hover || !result?.activation?.length) return null;
    const kernelSize = result.kernel?.length || 1;
    const stride = Math.max(1, Math.round(result.params?.stride ?? 1));
    const outputSize = result.activation.length;
    const imageSize = result.image?.length || outputSize * stride;

    if (hover.panel === "kernel") {
      const row = clamp(Math.round(hover.row), 0, kernelSize - 1);
      const column = clamp(Math.round(hover.column), 0, kernelSize - 1);
      return {
        panel: "kernel",
        row,
        column,
        weight: result.kernel[row]?.[column] ?? 0,
        kernelSize,
        finite: Number.isFinite(result.kernel[row]?.[column]),
      };
    }

    if (hover.panel === "activation") {
      const row = clamp(Math.round(hover.row), 0, outputSize - 1);
      const column = clamp(Math.round(hover.column), 0, outputSize - 1);
      return computeGridProbe(result, row, column);
    }

    const inputRow = clamp(Math.round(hover.row), 0, imageSize - 1);
    const inputColumn = clamp(Math.round(hover.column), 0, imageSize - 1);
    return computeGridProbe(
      result,
      Math.round(inputRow / stride),
      Math.round(inputColumn / stride),
    );
  }

  function gridLayout(width, height, options = {}, result = null) {
    const gap = Math.max(12, width * 0.022);
    const outer = 16;
    const labelHeight = 34;
    const probeBand =
      options.probeBand === false
        ? 0
        : clamp(options.probeBand ?? height * 0.3, 92, 148);
    const unit = width / 3.08;
    const imageSize = Math.max(
      56,
      Math.min(
        unit,
        (width - outer * 2 - gap * 2) / 3,
        height - labelHeight - probeBand - outer * 2,
      ),
    );
    const totalWidth = imageSize * 3 + gap * 2;
    const startX = (width - totalWidth) / 2;
    const startY = outer + labelHeight;
    const panels = {
      input: { x: startX, y: startY, size: imageSize },
      kernel: { x: startX + imageSize + gap, y: startY, size: imageSize },
      activation: { x: startX + (imageSize + gap) * 2, y: startY, size: imageSize },
    };
    const band = probeBand
      ? { x: startX, y: startY + imageSize + 12, width: totalWidth, height: probeBand - 12 }
      : null;
    return {
      width,
      height,
      gap,
      outer,
      labelHeight,
      imageSize,
      panels,
      band,
      hitTest(x, y) {
        for (const [name, panel] of Object.entries(panels)) {
          if (
            x >= panel.x &&
            x <= panel.x + panel.size &&
            y >= panel.y &&
            y <= panel.y + panel.size
          ) {
            const cells =
              name === "activation"
                ? resultCellCount(result, "activation", options)
                : name === "kernel"
                  ? resultCellCount(result, "kernel", options)
                  : resultCellCount(result, "input", options);
            return {
              panel: name,
              row: Math.floor(((y - panel.y) / panel.size) * cells),
              column: Math.floor(((x - panel.x) / panel.size) * cells),
            };
          }
        }
        return null;
      },
    };

    function resultCellCount(currentResult, panelName, currentOptions) {
      const fallback = currentOptions.cellCounts?.[panelName];
      if (panelName === "kernel") {
        return currentResult?.kernel?.length || fallback || 3;
      }
      if (panelName === "activation") {
        return currentResult?.activation?.length || fallback || 8;
      }
      return currentResult?.image?.length || fallback || 8;
    }
  }

  function drawProbeMiniGrid(ctx, matrix, x, y, size, options = {}) {
    const rows = matrix.length;
    const columns = matrix[0]?.length || 1;
    const cell = size / Math.max(rows, columns);
    renderMatrix(ctx, matrix, x, y, size, size, {
      min: options.min,
      max: options.max,
      colors: options.colors,
      border: options.border || "rgba(196,231,218,.22)",
    });
    if (cell >= 15) {
      ctx.save();
      ctx.font = `${clamp(cell * 0.34, 7, 10)}px ${FONT_MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const normalized =
            options.min === undefined || options.max === undefined
              ? 0.5
              : (matrix[row][column] - options.min) /
                (options.max - options.min || 1);
          ctx.fillStyle =
            normalized > 0.5 ? "rgba(4,16,14,.88)" : "rgba(228,244,238,.94)";
          ctx.fillText(
            trimNumber(matrix[row][column], 2),
            x + (column + 0.5) * cell,
            y + (row + 0.5) * cell,
          );
        }
      }
      ctx.restore();
    }
  }

  function drawProbeBand(ctx, layout, probe, result) {
    const band = layout.band;
    if (!band) return;
    ctx.save();
    ctx.fillStyle = "rgba(9,21,19,.72)";
    ctx.strokeStyle = "rgba(124,247,212,.25)";
    ctx.lineWidth = 1;
    ctx.fillRect(band.x, band.y, band.width, band.height);
    ctx.strokeRect(band.x + 0.5, band.y + 0.5, band.width - 1, band.height - 1);

    const pad = 12;
    let cursorX = band.x + pad;
    const textTop = band.y + pad;
    const lineHeight = 15;

    if (!probe) {
      label(ctx, "PROBE / 卷积探针", cursorX, textTop, {
        color: PROBE_ACCENT,
        size: 10,
      });
      label(ctx, "把鼠标移到输入图或激活图上，查看该位置的局部卷积过程", cursorX, textTop + lineHeight + 4, {
        color: MUTED,
        size: 10,
      });
      ctx.restore();
      return;
    }

    if (probe.panel === "kernel") {
      label(ctx, "KERNEL CELL / 卷积核单元", cursorX, textTop, {
        color: PROBE_KERNEL,
        size: 10,
      });
      label(
        ctx,
        `k(${probe.row}, ${probe.column}) = ${trimNumber(probe.weight, 3)}`,
        cursorX,
        textTop + lineHeight + 4,
        { color: INK, size: 11, mono: true },
      );
      label(
        ctx,
        "卷积核按高斯权重归一化：中心最大，边缘衰减。",
        cursorX,
        textTop + lineHeight * 2 + 8,
        { color: MUTED, size: 10 },
      );
      ctx.restore();
      return;
    }

    const kernelMax = Math.max(...probe.kernel.flat().map(Math.abs)) || 1;
    const productMax = Math.max(...probe.products.flat().map(Math.abs)) || 1;
    const gridSize = clamp(band.height - pad * 2 - 20, 42, 92);
    const reservedText = Math.min(
      Math.max(band.width * 0.34, 190),
      band.width - gridSize * 3 - pad * 3 - 24,
    );
    const gridStartX = Math.max(
      cursorX + reservedText,
      band.x + band.width - pad - gridSize * 3 - 24,
    );
    const gridGap = Math.max(
      8,
      (band.x + band.width - pad - gridStartX - gridSize * 3) / 2,
    );
    const gridY = band.y + pad + 18;

    label(ctx, "PROBE / 局部卷积", cursorX, textTop, {
      color: PROBE_ACCENT,
      size: 10,
    });
    const lines = [
      `输入像素 (x=${probe.inputColumn}, y=${probe.inputRow}) · I = ${trimNumber(probe.inputValue)}`,
      `输出单元 (${probe.outputColumn}, ${probe.outputRow}) · a = ${trimNumber(probe.outputValue)}`,
      `stride ${probe.stride} · gain ${trimNumber(probe.gain)} · 核 ${probe.kernelSize}×${probe.kernelSize}${
        probe.receptiveRect.top < 0 ||
        probe.receptiveRect.left < 0 ||
        probe.receptiveRect.top + probe.kernelSize > probe.imageSize ||
        probe.receptiveRect.left + probe.kernelSize > probe.imageSize
          ? " · 边缘零填充"
          : ""
      }`,
      `Σ I·k = ${trimNumber(probe.preActivation)} → ×gain ${trimNumber(probe.gained)} → ReLU ${trimNumber(probe.relu)} → /peak ${trimNumber(probe.outputValue)}`,
    ];
    lines.forEach((line, index) => {
      label(ctx, line, cursorX, textTop + lineHeight + 4 + index * lineHeight, {
        color: index === 3 ? PROBE_OUTPUT : INK,
        size: 10,
        mono: true,
      });
    });

    const miniGrids = [
      {
        title: "局部输入 I",
        matrix: probe.patch,
        min: 0,
        max: 1,
        colors: INPUT_COLORS,
        accent: PROBE_INPUT,
      },
      {
        title: `卷积核 k`,
        matrix: probe.kernel,
        min: 0,
        max: kernelMax,
        colors: KERNEL_COLORS,
        accent: PROBE_KERNEL,
      },
      {
        title: "逐点积 I·k",
        matrix: probe.products,
        min: 0,
        max: productMax,
        colors: ACTIVATION_COLORS,
        accent: PROBE_OUTPUT,
      },
    ];
    miniGrids.forEach((grid, index) => {
      const x = gridStartX + index * (gridSize + gridGap);
      label(ctx, grid.title, x, band.y + pad, {
        color: grid.accent,
        size: 9,
      });
      drawProbeMiniGrid(ctx, grid.matrix, x, gridY, gridSize, {
        min: grid.min,
        max: grid.max,
        colors: grid.colors,
      });
    });
    ctx.restore();
  }

  function drawPanelHighlight(ctx, panel, row, column, cells, color) {
    const cell = panel.size / cells;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(
      panel.x + column * cell + 0.5,
      panel.y + row * cell + 0.5,
      Math.max(1.5, cell),
      Math.max(1.5, cell),
    );
    ctx.restore();
  }

  function renderGridWithProbe(canvas, result, config = {}) {
    const setup = setupCanvas(canvas, config);
    const { ctx, width, height } = setup;
    const hoverState = canvas.__gridProbeHoverState || null;
    const hover =
      config.probe !== undefined
        ? config.probe
        : hoverState
          ? hoverState.hover
          : null;
    const probe = resolveGridProbe(result, hover);

    const layout = gridLayout(width, height, {
      probeBand: config.probeBand,
      cellCounts: {
        input: result?.image?.length,
        kernel: result?.kernel?.length,
        activation: result?.activation?.length,
      },
    }, result);
    canvas.__gridLayout = layout;
    canvas.__gridProbeResult = result;
    canvas.__gridProbeConfig = config;

    const { panels, gap, imageSize } = layout;
    label(ctx, "INPUT / 输入", panels.input.x, 15, { color: INK, size: 11 });
    label(
      ctx,
      `${result.image.length} × ${result.image.length}`,
      panels.input.x + imageSize,
      16,
      { align: "right", mono: true, size: 9 },
    );
    renderMatrix(ctx, result.image, panels.input.x, panels.input.y, imageSize, imageSize, {
      min: 0,
      max: 1,
      border: "rgba(196,231,218,.18)",
      colors: INPUT_COLORS,
    });

    label(ctx, "KERNEL / 卷积核", panels.kernel.x, 15, { color: INK, size: 11 });
    label(
      ctx,
      `${result.kernel.length} × ${result.kernel.length}`,
      panels.kernel.x + imageSize,
      16,
      { align: "right", mono: true, size: 9 },
    );
    renderMatrix(ctx, result.kernel, panels.kernel.x, panels.kernel.y, imageSize, imageSize, {
      border: "rgba(196,231,218,.18)",
      colors: KERNEL_COLORS,
      showValues: imageSize / result.kernel.length >= 15,
      digits: 2,
    });

    label(ctx, "ACTIVATION / 激活", panels.activation.x, 15, { color: INK, size: 11 });
    label(
      ctx,
      `${result.activation.length} × ${result.activation.length}`,
      panels.activation.x + imageSize,
      16,
      { align: "right", mono: true, size: 9 },
    );
    renderMatrix(
      ctx,
      result.activation,
      panels.activation.x,
      panels.activation.y,
      imageSize,
      imageSize,
      {
        min: 0,
        max: Math.max(1, result.metrics.maxActivation),
        border: "rgba(196,231,218,.18)",
        colors: ACTIVATION_COLORS,
      },
    );

    // 感受野回投：把探针覆盖的输入区域框出来，纯描边，不遮挡任何像素
    if (probe && probe.panel === "grid") {
      const cell = imageSize / result.image.length;
      const rect = probe.receptiveRect;
      ctx.save();
      ctx.strokeStyle = PROBE_ACCENT;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(
        panels.input.x + rect.left * cell,
        panels.input.y + rect.top * cell,
        rect.size * cell,
        rect.size * cell,
      );
      ctx.setLineDash([]);
      ctx.restore();
      drawPanelHighlight(
        ctx,
        panels.activation,
        probe.outputRow,
        probe.outputColumn,
        result.activation.length,
        PROBE_OUTPUT,
      );
    }
    if (hover?.panel === "kernel") {
      drawPanelHighlight(
        ctx,
        panels.kernel,
        hover.row,
        hover.column,
        result.kernel.length,
        PROBE_KERNEL,
      );
    }

    drawProbeBand(ctx, layout, probe, result);

    if (config.interactive !== false) attachGridProbe(canvas, config);
    canvas.__gridProbe = {
      layout,
      probe,
      hover,
      redraw: () =>
        renderGridWithProbe(canvas, canvas.__gridProbeResult, {
          ...(canvas.__gridProbeConfig || {}),
          probe: undefined,
        }),
    };
    return { width, height, layout, probe, hover };
  }

  function attachGridProbe(canvas, config = {}) {
    if (canvas.__gridProbeAttached) return canvas.__gridProbeAttached;
    const state = { hover: null };
    canvas.__gridProbeHoverState = state;

    const toCanvasPoint = (event) => {
      const rect = canvas.getBoundingClientRect();
      const layout = canvas.__gridLayout;
      if (!layout || !rect.width || !rect.height) return null;
      return {
        x: ((event.clientX - rect.left) / rect.width) * layout.width,
        y: ((event.clientY - rect.top) / rect.height) * layout.height,
      };
    };

    const apply = (next) => {
      const previous = state.hover;
      const same =
        (!previous && !next) ||
        (previous &&
          next &&
          previous.panel === next.panel &&
          previous.row === next.row &&
          previous.column === next.column);
      if (same) return;
      state.hover = next;
      canvas.__gridProbe?.redraw?.();
      if (typeof config.onProbeChange === "function") {
        config.onProbeChange(canvas.__gridProbe?.probe ?? null, next);
      }
    };

    const handleMove = (event) => {
      const point = toCanvasPoint(event);
      if (!point || !canvas.__gridLayout) return;
      apply(canvas.__gridLayout.hitTest(point.x, point.y));
    };
    const handleLeave = () => apply(null);

    canvas.addEventListener("pointermove", handleMove);
    canvas.addEventListener("pointerdown", handleMove);
    canvas.addEventListener("pointerleave", handleLeave);
    canvas.addEventListener("pointercancel", handleLeave);
    canvas.__gridProbeAttached = {
      detach() {
        canvas.removeEventListener("pointermove", handleMove);
        canvas.removeEventListener("pointerdown", handleMove);
        canvas.removeEventListener("pointerleave", handleLeave);
        canvas.removeEventListener("pointercancel", handleLeave);
        canvas.__gridProbeAttached = null;
      },
      state,
    };
    return canvas.__gridProbeAttached;
  }

  /* ------------------------------------------------------------------ *
   * Vector_Physics_2D：相空间轨迹（方向箭头 + 时间起终点）
   * ------------------------------------------------------------------ */

  const PHASE_AXES = {
    pendulum: { x: "摆角 θ (rad)", y: "角速度 dθ/dt (rad/s)" },
    oscillator: { x: "位移 x(t)", y: "速度 dx/dt (m/s)" },
  };

  function computePhaseTrajectory(result, options = {}) {
    const series = result?.series || {};
    const xValues = options.xValues || series.current || [];
    const yValues = options.yValues || series.velocity || [];
    const count = Math.min(xValues.length, yValues.length);
    const points = [];
    for (let index = 0; index < count; index += 1) {
      const x = xValues[index];
      const y = yValues[index];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x, y, index });
    }

    const baselinePoints = [];
    const baseX = series.baseline;
    const baseY = series.baselineVelocity;
    if (options.baseline !== false && Array.isArray(baseX) && Array.isArray(baseY)) {
      const baselineCount = Math.min(baseX.length, baseY.length);
      for (let index = 0; index < baselineCount; index += 1) {
        const x = baseX[index];
        const y = baseY[index];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        baselinePoints.push({ x, y, index });
      }
    }

    const halfX =
      Math.max(
        options.minHalfX || 0,
        finiteExtent(points.map((point) => point.x)),
        finiteExtent(baselinePoints.map((point) => point.x)),
      ) * 1.08 || 1;
    const halfY =
      Math.max(
        options.minHalfY || 0,
        finiteExtent(points.map((point) => point.y)),
        finiteExtent(baselinePoints.map((point) => point.y)),
      ) * 1.08 || 1;

    const times = Array.isArray(result?.x) ? result.x : null;
    const timeAt = (index) => (times && Number.isFinite(times[index]) ? times[index] : index);
    const start = points[0] || null;
    const end = points.at(-1) || null;

    const arrowCount = Math.max(2, options.arrowCount ?? 7);
    const arrows = [];
    if (points.length > 2) {
      for (let step = 1; step <= arrowCount; step += 1) {
        const ratio = step / (arrowCount + 1);
        const index = clamp(Math.round(ratio * (points.length - 1)), 1, points.length - 2);
        const from = points[index];
        const to = points[Math.min(points.length - 1, index + 3)];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length < 1e-9) continue;
        arrows.push({
          x: from.x,
          y: from.y,
          angle: Math.atan2(dy, dx),
          progress: index / (points.length - 1),
        });
      }
    }

    const markerTime = Number.isFinite(options.markerTime) ? options.markerTime : null;
    let marker = null;
    if (markerTime !== null && times && points.length) {
      let bestIndex = 0;
      let bestDelta = Infinity;
      for (let index = 0; index < points.length; index += 1) {
        const delta = Math.abs(timeAt(points[index].index) - markerTime);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIndex = index;
        }
      }
      marker = { ...points[bestIndex], time: timeAt(points[bestIndex].index) };
    }

    return {
      points,
      baseline: baselinePoints,
      arrows,
      start: start ? { ...start, time: timeAt(start.index) } : null,
      end: end ? { ...end, time: timeAt(end.index) } : null,
      marker,
      domain: [-halfX, halfX],
      range: [-halfY, halfY],
      labels: PHASE_AXES[result?.domain] || {
        x: options.xLabel || "状态量 x",
        y: options.yLabel || "状态量 dx/dt",
      },
      finite: points.length > 1,
    };
  }

  function drawArrowHead(ctx, x, y, angle, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.72, size * 0.6);
    ctx.lineTo(-size * 0.72, -size * 0.6);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function renderPhaseSpaceTrajectory(canvas, result, config = {}) {
    const setup = setupCanvas(canvas, config);
    const { ctx, width, height } = setup;
    const model = computePhaseTrajectory(result, config);
    const sized = { ...config, width, height };
    const effective = {
      ...sized,
      xDomain: model.domain,
      yDomainResolved: model.range,
      xLabel: config.xLabel || model.labels.x,
      yLabel: config.yLabel || model.labels.y,
      series: [],
    };
    const bounds = resolvePlotBounds(effective);
    drawGrid(ctx, bounds, effective);
    drawAxisLabels(ctx, bounds, effective);

    const mapX = makeScale(model.domain, [bounds.left, bounds.right]);
    const mapY = makeScale(model.range, [bounds.bottom, bounds.top]);

    ctx.save();
    ctx.beginPath();
    ctx.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    ctx.clip();

    // 零轴：给轨迹一个绝对参照
    ctx.strokeStyle = "rgba(196,231,218,.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bounds.left, Math.round(mapY(0)) + 0.5);
    ctx.lineTo(bounds.right, Math.round(mapY(0)) + 0.5);
    ctx.moveTo(Math.round(mapX(0)) + 0.5, bounds.top);
    ctx.lineTo(Math.round(mapX(0)) + 0.5, bounds.bottom);
    ctx.stroke();

    if (model.baseline.length > 1) {
      ctx.beginPath();
      model.baseline.forEach((point, index) => {
        const x = mapX(point.x);
        const y = mapY(point.y);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "#71847e";
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.62;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // 主轨迹：颜色按时间从青到橙渐变，方向即时间流向
    const points = model.points;
    if (points.length > 1) {
      ctx.lineWidth = config.lineWidth || 1.8;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const segment = Math.max(1, Math.floor(points.length / 220));
      for (let index = 0; index + segment < points.length; index += segment) {
        const from = points[index];
        const to = points[index + segment];
        const progress = index / (points.length - 1);
        ctx.beginPath();
        ctx.moveTo(mapX(from.x), mapY(from.y));
        ctx.lineTo(mapX(to.x), mapY(to.y));
        ctx.strokeStyle = mixHex(TRAJECTORY_START, TRAJECTORY_END, progress);
        ctx.globalAlpha = 0.55 + 0.45 * progress;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const arrow of model.arrows) {
        drawArrowHead(
          ctx,
          mapX(arrow.x),
          mapY(arrow.y),
          -arrow.angle, // canvas y 轴向下，角度取反
          4.6,
          mixHex(TRAJECTORY_START, TRAJECTORY_END, arrow.progress),
        );
      }
    }

    if (model.start) {
      const x = mapX(model.start.x);
      const y = mapY(model.start.y);
      ctx.beginPath();
      ctx.arc(x, y, 4.4, 0, Math.PI * 2);
      ctx.fillStyle = TRAJECTORY_START;
      ctx.fill();
      ctx.strokeStyle = "rgba(6,20,17,.85)";
      ctx.lineWidth = 1;
      ctx.stroke();
      drawText(ctx, `起点 t=${trimNumber(model.start.time, 1)}`, x + 8, y - 8, {
        color: TRAJECTORY_START,
        mono: true,
        size: 9,
      });
    }

    if (model.end) {
      const x = mapX(model.end.x);
      const y = mapY(model.end.y);
      ctx.beginPath();
      ctx.rect(x - 4, y - 4, 8, 8);
      ctx.fillStyle = TRAJECTORY_END;
      ctx.fill();
      ctx.strokeStyle = "rgba(6,20,17,.85)";
      ctx.lineWidth = 1;
      ctx.stroke();
      drawText(ctx, `终点 t=${trimNumber(model.end.time, 1)}`, x + 8, y + 14, {
        color: TRAJECTORY_END,
        mono: true,
        size: 9,
      });
    }

    if (model.marker) {
      const x = mapX(model.marker.x);
      const y = mapY(model.marker.y);
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,.6)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      drawText(ctx, `t=${trimNumber(model.marker.time, 1)}`, x + 9, y + 4, {
        color: INK,
        mono: true,
        size: 9,
      });
    }

    ctx.restore();

    if (config.showLegend !== false) {
      const legendText = config.legendText || "轨迹按时间 青 → 橙，箭头为演化方向";
      drawText(ctx, legendText, bounds.left + 8, bounds.top + 20, {
        color: MUTED,
        size: 9,
      });
    }

    return { bounds, model, xDomain: model.domain, yDomain: model.range };
  }

  function canvasHash(canvas, step = 16) {
    const ctx = canvas.getContext("2d");
    if (!canvas.__pixelBuffer) {
      canvas.__pixelBuffer = document.createElement("canvas");
    }
    const buffer = canvas.__pixelBuffer;
    const targetWidth = 240;
    const targetHeight = Math.max(
      1,
      Math.round((targetWidth * canvas.height) / Math.max(1, canvas.width)),
    );
    if (buffer.width !== targetWidth || buffer.height !== targetHeight) {
      buffer.width = targetWidth;
      buffer.height = targetHeight;
    }
    const bufferContext = buffer.getContext("2d", { willReadFrequently: true });
    bufferContext.clearRect(0, 0, targetWidth, targetHeight);
    bufferContext.drawImage(canvas, 0, 0, targetWidth, targetHeight);
    const data = bufferContext.getImageData(0, 0, targetWidth, targetHeight).data;
    let hash = 2166136261;
    let sum = 0;
    let count = 0;
    for (let index = 0; index < data.length; index += 4 * step) {
      const luminance =
        (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) /
        255;
      sum += luminance;
      count += 1;
      hash ^= Math.round(luminance * 65535);
      hash = Math.imul(hash, 16777619);
    }
    return {
      hash: (hash >>> 0).toString(16).padStart(8, "0"),
      meanLuminance: count ? sum / count : 0,
    };
  }

  function canvasMse(canvasA, canvasB, step = 32) {
    function sampleData(canvas) {
      if (!canvas.__pixelBuffer) {
        canvas.__pixelBuffer = document.createElement("canvas");
      }
      const buffer = canvas.__pixelBuffer;
      const targetWidth = 320;
      const targetHeight = Math.max(
        1,
        Math.round((targetWidth * canvas.height) / Math.max(1, canvas.width)),
      );
      if (buffer.width !== targetWidth || buffer.height !== targetHeight) {
        buffer.width = targetWidth;
        buffer.height = targetHeight;
      }
      const context = buffer.getContext("2d", { willReadFrequently: true });
      context.clearRect(0, 0, targetWidth, targetHeight);
      context.drawImage(canvas, 0, 0, targetWidth, targetHeight);
      return context.getImageData(0, 0, targetWidth, targetHeight).data;
    }
    const dataA = sampleData(canvasA);
    const dataB = sampleData(canvasB);
    let sum = 0;
    let count = 0;
    for (let index = 0; index < Math.min(dataA.length, dataB.length); index += 4 * step) {
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = (dataA[index + channel] - dataB[index + channel]) / 255;
        sum += delta * delta;
        count += 1;
      }
    }
    return count ? sum / count : 0;
  }

  return {
    canvasHash,
    canvasMse,
    computeGridProbe,
    computePhaseTrajectory,
    formatTick,
    gridLayout,
    niceTicks,
    renderGridWithProbe,
    renderPhaseSpaceTrajectory,
    renderPhasePortrait,
    renderPlot,
    renderTriptych,
  };
});
