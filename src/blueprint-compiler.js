(function (root, factory) {
  const SimMath =
    typeof module === "object" && module.exports
      ? require("./simmath.js")
      : root.SimMath;
  const api = factory(SimMath);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PhenomenaCompiler = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SimMath) {
  "use strict";

  const TAU = Math.PI * 2;
  const MAX_SAMPLES = 1200;
  const MAX_CONTROLS = 6;
  const ALLOWED_VIEWS = new Set(["2D_Plot", "Dual_Plot", "Parameter_Sweep"]);
  const ALLOWED_OUTPUTS = new Set(["series", "scalar", "indicator"]);

  class BlueprintError extends Error {
    constructor(message, path = "") {
      super(path ? `${path}: ${message}` : message);
      this.name = "BlueprintError";
      this.path = path;
    }
  }

  function fail(message, path) {
    throw new BlueprintError(message, path);
  }

  function asFiniteNumber(value, path) {
    const number = typeof value === "string" ? Number(value) : value;
    if (!Number.isFinite(number)) fail("必须是有限数值", path);
    return number;
  }

  function asShortString(value, path, maxLength = 160) {
    if (typeof value !== "string" || !value.trim()) fail("必须是非空字符串", path);
    const text = value.trim();
    if (text.length > maxLength) fail(`长度不能超过 ${maxLength}`, path);
    return text;
  }

  function asIdentifier(value, path) {
    const text = asShortString(value, path, 48);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text)) {
      fail("只能包含字母、数字和下划线，且不能以数字开头", path);
    }
    return text;
  }

  function normalizeControlId(key, index) {
    const ascii = String(key || "")
      .trim()
      .replace(/[^\x00-\x7f]/g, "")
      .replace(/[^a-zA-Z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ascii) && ascii
      ? ascii
      : `param_${index + 1}`;
  }

  function normalizeFormulaExpression(expression) {
    return String(expression || "")
      .replace(/Math\.([a-zA-Z]+)/g, "$1")
      .replace(/\bclamp\s*\(/g, "clamp(")
      .replace(/\s+/g, " ")
      .trim();
  }

  function validateFormulaExpression(expression, allowedNames, path) {
    const text = normalizeFormulaExpression(expression);
    if (!text) fail("表达式不能为空", path);
    if (text.length > 700) fail("表达式过长", path);
    if (text.includes("=") || text.includes(";") || text.includes("`")) {
      fail("表达式不能包含赋值、分号或模板字符串", path);
    }
    if (/[^\s\w.+\-*/^()<>=!?:,%[\]]/u.test(text)) {
      fail("表达式包含不允许的符号", path);
    }
    if (/[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(text)) {
      const calls = text.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g) || [];
      const allowedFunctions = new Set([
        "sin",
        "cos",
        "tan",
        "asin",
        "acos",
        "atan",
        "atan2",
        "sinh",
        "cosh",
        "tanh",
        "exp",
        "log",
        "log10",
        "sqrt",
        "abs",
        "sign",
        "min",
        "max",
        "pow",
        "floor",
        "ceil",
        "round",
        "clamp",
        "hypot",
        "PI",
      ]);
      for (const match of calls) {
        const name = match.slice(0, match.indexOf("(")).trim();
        if (!allowedFunctions.has(name)) {
          fail(`不允许调用函数 ${name}`, path);
        }
      }
    }
    const identifiers = text.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    const allowed = new Set([
      "t",
      "i",
      "index",
      "PI",
      "TAU",
      "abs",
      "sign",
      "sin",
      "cos",
      "tan",
      "asin",
      "acos",
      "atan",
      "atan2",
      "sinh",
      "cosh",
      "tanh",
      "exp",
      "log",
      "log10",
      "sqrt",
      "pow",
      "min",
      "max",
      "floor",
      "ceil",
      "round",
      "clamp",
      "hypot",
      "theta",
      "omega",
      "omega0",
      "omegaD",
      "driveFreq",
      "driveAmp",
      "t0",
      "t1",
      "p",
      "params",
    ]);
    for (const identifier of identifiers) {
      if (!allowed.has(identifier) && !allowedNames.has(identifier)) {
        fail(`未知标识符 ${identifier}`, path);
      }
    }
    return text;
  }

  function createFormulaScope(controlMap, extraNames = []) {
    const names = new Set(extraNames);
    for (const control of controlMap.values()) {
      names.add(control.id);
      names.add(control.symbol);
    }
    return {
      names,
      context: null,
      build(params) {
        const scope = {
          p: params,
          params,
          PI: Math.PI,
          TAU,
          abs: Math.abs,
          sign: Math.sign,
          sin: Math.sin,
          cos: Math.cos,
          tan: Math.tan,
          asin: Math.asin,
          acos: Math.acos,
          atan: Math.atan,
          atan2: Math.atan2,
          sinh: Math.sinh,
          cosh: Math.cosh,
          tanh: Math.tanh,
          exp: Math.exp,
          log: Math.log,
          log10: Math.log10,
          sqrt: Math.sqrt,
          pow: Math.pow,
          min: Math.min,
          max: Math.max,
          floor: Math.floor,
          ceil: Math.ceil,
          round: Math.round,
          clamp: SimMath.clamp,
          hypot: Math.hypot,
        };
        for (const control of controlMap.values()) {
          const value = Number(params[control.id]);
          scope[control.id] = value;
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(control.symbol)) {
            scope[control.symbol] = value;
          }
        }
        return scope;
      },
    };
  }

  function createSafeEvaluator(expression, scopeNames, path) {
    const normalized = validateFormulaExpression(
      expression,
      scopeNames,
      path,
    );
    try {
      const names = [
        ...new Set([
          ...scopeNames,
          "t",
          "i",
          "index",
          "abs",
          "sign",
          "sin",
          "cos",
          "tan",
          "asin",
          "acos",
          "atan",
          "atan2",
          "sinh",
          "cosh",
          "tanh",
          "exp",
          "log",
          "log10",
          "sqrt",
          "pow",
          "min",
          "max",
          "floor",
          "ceil",
          "round",
          "clamp",
          "hypot",
          "PI",
          "TAU",
        ]),
      ].filter(
        (name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name),
      );
      const fn = new Function(
        ...names,
        `"use strict"; return (${normalized});`,
      );
      return (scope) => {
        try {
          const args = names.map((name) => scope[name]);
          const value = Number(fn(...args));
          if (!Number.isFinite(value)) return null;
          return value;
        } catch {
          return null;
        }
      };
    } catch (error) {
      fail(`表达式解析失败：${error.message}`, path);
    }
    return null;
  }

  function normalizeControl(raw, index) {
    const path = `interactive_controls[${index}]`;
    if (!raw || typeof raw !== "object") fail("控制量必须是对象", path);
    const id = normalizeControlId(
      raw.id || raw.symbol || `param_${index + 1}`,
      index,
    );
    const label = asShortString(raw.label || id, `${path}.label`, 120);
    const symbol = asShortString(raw.symbol || id, `${path}.symbol`, 20);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol)) {
      fail("symbol 必须是合法的 ASCII 标识符", `${path}.symbol`);
    }
    const unit =
      typeof raw.unit === "string" ? raw.unit.trim().slice(0, 24) : "";
    const min = asFiniteNumber(raw.min, `${path}.min`);
    const max = asFiniteNumber(raw.max, `${path}.max`);
    const step = asFiniteNumber(raw.step, `${path}.step`);
    const defaultValue = asFiniteNumber(
      raw.default ?? raw.defaultValue ?? min,
      `${path}.default`,
    );
    if (max <= min) fail("max 必须大于 min", path);
    if (step <= 0) fail("step 必须大于 0", path);
    if (defaultValue < min || defaultValue > max) {
      fail("default 必须落在 [min, max] 内", path);
    }
    return {
      id,
      symbol,
      label,
      unit,
      min,
      max,
      step,
      default: defaultValue,
      effect: asShortString(
        raw.physical_effect ||
          raw.effect ||
          `${label}会改变真实计算结果，并反映到当前曲线上。`,
        `${path}.physical_effect`,
        240,
      ),
    };
  }

  function normalizeOutput(raw, index, controls, formulaScope, params) {
    const path = `mathematical_model.pipeline[${index}]`;
    if (!raw || typeof raw !== "object") fail("计算步骤必须是对象", path);
    const kind = raw.kind || raw.type || "series";
    if (!ALLOWED_OUTPUTS.has(kind)) {
      fail(`不支持的步骤类型 ${kind}`, path);
    }
    const id = asIdentifier(raw.id || `${kind}_${index + 1}`, `${path}.id`);
    const label = asShortString(
      raw.label || id,
      `${path}.label`,
      80,
    );
    const unit =
      typeof raw.unit === "string" ? raw.unit.trim().slice(0, 24) : "";
    const expression = normalizeFormulaExpression(raw.expression || raw.formula || "");
    if (!expression) fail("必须给出 expression", path);
    const sampleCountRaw = raw.sampleCount || raw.samples || 320;
    const sampleCount = Math.round(
      asFiniteNumber(sampleCountRaw, `${path}.sampleCount`),
    );
    if (sampleCount < 16 || sampleCount > MAX_SAMPLES) {
      fail(`sampleCount 必须在 16..${MAX_SAMPLES}`, path);
    }
    const xMin =
      raw.xMin ?? raw.range?.[0] ?? raw.x_range?.[0] ?? 0;
    const xMax =
      raw.xMax ?? raw.range?.[1] ?? raw.x_range?.[1] ?? sampleCount - 1;
    const xStart = asFiniteNumber(xMin, `${path}.xMin`);
    const xEnd = asFiniteNumber(xMax, `${path}.xMax`);
    if (xEnd <= xStart) fail("xMax 必须大于 xMin", path);
    const evaluator = createSafeEvaluator(
      expression,
      formulaScope.names,
      `${path}.expression`,
    );
    return {
      id,
      kind,
      label,
      unit,
      expression,
      sampleCount,
      xMin: xStart,
      xMax: xEnd,
      evaluator,
    };
  }

  function normalizeBlueprint(raw) {
    if (!raw || typeof raw !== "object") fail("蓝图必须是 JSON 对象", "root");
    const title = asShortString(
      raw.concept_title || raw.title,
      "concept_title",
      100,
    );
    const goal = asShortString(
      raw.pedagogical_goal || raw.goal,
      "pedagogical_goal",
      300,
    );
    const shortName =
      typeof raw.short_name === "string"
        ? raw.short_name.slice(0, 48)
        : "DYNAMIC / COMPILED";
    const model = raw.mathematical_model || {};
    const equationList =
      model.governing_equations_latex ||
      raw.equations ||
      [];
    const equations = (Array.isArray(equationList) ? equationList : [])
      .map((equation, index) =>
        asShortString(equation, `equations[${index}]`, 240),
      )
      .slice(0, 3);
    if (!equations.length) fail("至少需要一条控制方程", "equations");
    const controlsRaw = raw.interactive_controls || raw.controls || [];
    if (!Array.isArray(controlsRaw) || controlsRaw.length < 1) {
      fail("至少需要一个交互控制量", "interactive_controls");
    }
    if (controlsRaw.length > MAX_CONTROLS) {
      fail(`控制量不能超过 ${MAX_CONTROLS} 个`, "interactive_controls");
    }
    const controls = controlsRaw.map(normalizeControl);
    const seen = new Set();
    for (const control of controls) {
      if (seen.has(control.id)) fail(`控制量 id 重复：${control.id}`, "interactive_controls");
      seen.add(control.id);
    }
    const defaultParams = {};
    for (const control of controls) defaultParams[control.id] = control.default;
    const controlMap = new Map(controls.map((control) => [control.id, control]));
    const formulaScope = createFormulaScope(controlMap, ["t", "i"]);
    const pipelineRaw =
      model.pipeline ||
      model.outputs ||
      model.series ||
      [];
    if (!Array.isArray(pipelineRaw) || !pipelineRaw.length) {
      fail(
        "动态蓝图需要 mathematical_model.pipeline 数组；只写方程而没有数值图表达无法安全编译。",
        "mathematical_model.pipeline",
      );
    }
    if (pipelineRaw.length > 8) {
      fail("pipeline 不能超过 8 个步骤", "mathematical_model.pipeline");
    }
    const pipeline = pipelineRaw.map((output, index) =>
      normalizeOutput(output, index, controls, formulaScope, defaultParams),
    );
    const viewsRaw = raw.visual_views || [];
    const viewType =
      viewsRaw[0]?.type ||
      raw.view_type ||
      "Dual_Plot";
    if (!ALLOWED_VIEWS.has(viewType)) {
      fail(
        `当前动态编译器支持 ${[...ALLOWED_VIEWS].join(", ")}；网格/向量画布请使用内置模型或扩展原语。`,
        "visual_views[0].type",
      );
    }
    const presetsRaw = raw.aha_presets || raw.presets || [];
    const presets = (Array.isArray(presetsRaw) ? presetsRaw : [])
      .slice(0, 5)
      .map((preset, index) => {
        const values = preset.param_values || preset.params || {};
        const normalized = {};
        for (const control of controls) {
          const candidate = values[control.id] ?? values[control.symbol] ?? control.default;
          normalized[control.id] = SimMath.clamp(
            asFiniteNumber(candidate, `presets[${index}].${control.id}`),
            control.min,
            control.max,
          );
        }
        return {
          id: normalizeControlId(
            preset.id || `preset_${index + 1}`,
            index,
          ),
          name: asShortString(preset.name || `预设 ${index + 1}`, `presets[${index}].name`, 60),
          tag:
            typeof preset.tag === "string"
              ? preset.tag.slice(0, 20)
              : `STATE ${String(index + 1).padStart(2, "0")}`,
          description: asShortString(
            preset.description || "观察这一组参数下的真实响应。",
            `presets[${index}].description`,
            180,
          ),
          params: normalized,
        };
      });
    if (!presets.length) {
      presets.push({
        id: "baseline",
        name: "默认状态",
        tag: "BASELINE",
        description: "从默认参数出发，观察真实数值响应。",
        params: { ...defaultParams },
      });
    }
    return {
      ...raw,
      concept_title: title,
      pedagogical_goal: goal,
      short_name: shortName,
      interactive_controls: controls,
      aha_presets: presets,
      visual_views: [
        {
          view_id: "main_canvas",
          type: viewType,
          x_axis: viewsRaw[0]?.x_axis || "x",
          y_axis: viewsRaw[0]?.y_axis || "response",
          layers:
            Array.isArray(viewsRaw[0]?.layers) && viewsRaw[0].layers.length
              ? viewsRaw[0].layers
              : ["灰色虚线：初始参考", "彩色实线：当前响应"],
        },
      ],
      mathematical_model: {
        ...model,
        governing_equations_latex: equations,
        numerical_algorithm:
          model.numerical_algorithm ||
          "按白名单表达式逐点计算；每个输出都需要通过有限值探针。",
        pipeline,
      },
      _compiled: {
        controls,
        pipeline,
        formulaScope,
        defaultParams,
        viewType,
      },
    };
  }

  function evaluateStep(step, params, scope) {
    const context = {
      ...scope,
      p: params,
      params,
    };
    const x = SimMath.linspace(step.xMin, step.xMax, step.sampleCount);
    if (step.kind === "scalar") {
      const value = step.evaluator(context);
      return { ...step, value };
    }
    if (step.kind === "indicator") {
      const value = evaluateStep({ ...step, kind: "series" }, params, scope);
      const finiteValues = value.values.filter((item) => item !== null);
      const sum = finiteValues.reduce((total, item) => total + item, 0);
      return {
        ...step,
        value:
          Math.abs(value.xMax - value.xMin) > 0
            ? sum / finiteValues.length
            : sum,
        values: value.values,
        x: value.x,
      };
    }
    const values = new Array(step.sampleCount);
    for (let index = 0; index < step.sampleCount; index += 1) {
      const t = x[index];
      context.t = t;
      context.x = t;
      context.i = index;
      context.index = index;
      values[index] = step.evaluator(context);
    }
    return { ...step, data: values };
  }

  function compileBlueprint(raw, options = {}) {
    const blueprint = normalizeBlueprint(raw);
    const controls = blueprint._compiled.controls;
    const compiled = blueprint._compiled;
    const pipeline = compiled.pipeline;
    const params = { ...blueprint._compiled.defaultParams };
    const domain = {
      id: normalizeControlId(
        raw.id || `dynamic_${Date.now().toString(36)}`,
        0,
      ).replace(/^param_/, "dynamic_"),
      index: options.index || "DYN",
      name: blueprint.concept_title,
      shortName: blueprint.short_name,
      subtitle:
        typeof raw.subtitle === "string"
          ? raw.subtitle.slice(0, 100)
          : "动态编译的交互式数值仪器",
      question:
        typeof raw.question === "string"
          ? raw.question.slice(0, 260)
          : `当你改变参数时，${blueprint.concept_title} 的数值响应如何变化？`,
      goal: blueprint.pedagogical_goal,
      equations: blueprint.mathematical_model.governing_equations_latex,
      algorithm:
        blueprint.mathematical_model.numerical_algorithm ||
        "白名单数值表达式编译；运行时探针检查 NaN 与 Infinity。",
      helpers: ["linspace", "finiteStats"],
      palette:
        Array.isArray(raw.palette) && raw.palette.length >= 3
          ? raw.palette.slice(0, 3)
          : ["#7cf7d4", "#ffcf70", "#8ea2ff"],
      controls,
      presets: blueprint.aha_presets,
      views: blueprint.visual_views.map((view) => ({
        ...view,
        label: view.label || "动态响应",
      })),
      dynamic: true,
      blueprint: {
        ...blueprint,
        _compiled: undefined,
      },
      metrics: [
        { key: "outputPeak", label: "输出峰值", unit: "", digits: 2 },
        { key: "outputMean", label: "输出均值", unit: "", digits: 2 },
        { key: "outputSpan", label: "动态范围", unit: "", digits: 2 },
      ],
      presetGlow: "rgba(124,247,212,.22)",
      compute(nextParams = params) {
        const normalized = { ...params };
        for (const control of controls) {
          const numeric = Number(nextParams?.[control.id]);
          normalized[control.id] = SimMath.clamp(
            Number.isFinite(numeric) ? numeric : control.default,
            control.min,
            control.max,
          );
        }
        const scope = {
          ...compiled.formulaScope.build(normalized),
          t: 0,
          i: 0,
          index: 0,
        };
        const outputs = pipeline.map((step) => evaluateStep(step, normalized, scope));
        const numericSeries = outputs
          .filter((step) => Array.isArray(step.data))
          .map((step) => step.data)
          .filter((values) => values.length);
        const primary =
          outputs.find((step) => step.kind === "series" && Array.isArray(step.data)) ||
          outputs.find((step) => Array.isArray(step.data));
        const values = primary?.data || [0];
        const finiteValues = values.filter((value) => value !== null);
        const safeValues = finiteValues.length ? finiteValues : [0];
        const min = Math.min(...safeValues);
        const max = Math.max(...safeValues);
        const span = max - min;
        const scalars = Object.fromEntries(
          outputs
            .filter((step) => step.kind === "scalar" || step.kind === "indicator")
            .map((step) => [step.id, step.value]),
        );
        const series = {
          current: values,
        };
        outputs.forEach((step) => {
          if (Array.isArray(step.data)) series[step.id] = step.data;
        });
        series.baseline = primary
          ? series[primary.id]?.slice() || []
          : [];
        return {
          domain: domain.id,
          params: normalized,
          x: primary?.x || SimMath.linspace(0, 1, safeValues.length),
          series,
          axes: {
            xLabel: primary?.label || "x",
            yLabel: primary?.unit || "response",
            xRange: [primary?.xMin || 0, primary?.xMax || 1],
            yRange: [min - Math.abs(span) * 0.08, max + Math.abs(span) * 0.08],
          },
          metrics: {
            outputPeak: max,
            outputMean:
              finiteValues.reduce((sum, value) => sum + value, 0) /
              Math.max(1, finiteValues.length),
            outputSpan: span,
            ...scalars,
          },
          checks: {
            finite: numericSeries.every((series) =>
              SimMath.finiteStats(series).finite,
            ),
          },
          insight: blueprint.pedagogical_goal,
          blueprint: domain.blueprint,
        };
      }
    };
    return domain;
  }

  return {
    BlueprintError,
    compileBlueprint,
    normalizeBlueprint,
    validateFormulaExpression,
  };
});
