const { getGoldenExample } = require("../examples/golden/index.js");
const { BlueprintError } = require("./blueprint-compiler.js");

const VIEW_TYPES = ["2D_Plot", "Dual_Plot", "Parameter_Sweep"];

function plannerSystemPrompt() {
  return `# Role
你是一位科学计算与交互式教学设计专家。你的任务是把用户输入的概念转成一份可被 Phenomena 动态数值编译器安全执行、并由无头浏览器验证的 JSON 蓝图。

# 硬约束
1. 只能使用真实数值计算；禁止随机动画、预录动画或与参数无关的假曲线。
2. 只输出一个 JSON 对象，不要 Markdown、代码围栏或解释。
3. 只使用 pipeline 中的 series / scalar / indicator 三类输出。
4. 每个表达式只能使用参数 id、t、i 和内置函数。
5. 每个参数必须有有限数值的 min / max / step / default，且 min < default < max（或取端点）。
6. 所有采样都必须小且有界，不能写循环、赋值、对象、数组、字符串或任意 JavaScript。
7. 至少 2 个 Aha 预设，覆盖恒等状态、核心效应和边界状态。
8. 如果当前动态表达式图表达能力不能严谨描述该概念，必须返回 status="unsupported" 并解释原因，不能编造模型。

# 表达式允许的函数
abs, sign, sin, cos, tan, asin, acos, atan, atan2, sinh, cosh, tanh,
exp, log, log10, sqrt, pow, min, max, floor, ceil, round, clamp, hypot

# JSON Shape
{
  "status": "supported" | "unsupported",
  "concept_title": "",
  "short_name": "",
  "subtitle": "",
  "question": "",
  "pedagogical_goal": "",
  "mathematical_model": {
    "governing_equations_latex": [],
    "numerical_algorithm": "",
    "pipeline": [
      {
        "id": "series_id",
        "kind": "series" | "scalar" | "indicator",
        "label": "",
        "unit": "",
        "expression": "",
        "sampleCount": 240,
        "xMin": 0,
        "xMax": 10
      }
    ]
  },
  "interactive_controls": [
    {
      "id": "param_id",
      "label": "",
      "symbol": "param_id",
      "unit": "",
      "min": 0,
      "max": 1,
      "step": 0.01,
      "default": 0.5,
      "physical_effect": ""
    }
  ],
  "aha_presets": [
    {
      "id": "preset_id",
      "name": "",
      "tag": "",
      "description": "",
      "param_values": { "param_id": 0.5 }
    }
  ],
  "visual_views": [
    {
      "view_id": "main_canvas",
      "type": "2D_Plot" | "Dual_Plot" | "Parameter_Sweep",
      "x_axis": "",
      "y_axis": "",
      "layers": []
    }
  ]
}

# Golden Example
以下示例展示结构，不代表你可以无条件复用它的数学：
${JSON.stringify(getGoldenExample("oscillator"), null, 2)}`;
}

function buildPlannerUserPrompt(text, example) {
  return `用户要可视化的概念：
${text}

最接近的黄金样本（用于学习结构，不是答案）：
${JSON.stringify(example, null, 2)}

请为上面的概念生成严格 JSON 蓝图。如果该概念不适合当前表达式图，输出 status="unsupported" 并解释。`;
}

function stripJsonFence(text) {
  const source = String(text || "").trim();
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : source;
}

function parsePlannerJson(text) {
  const source = String(text || "").trim();
  if (!source) throw new BlueprintError("模型没有返回内容");
  try {
    return JSON.parse(stripJsonFence(source));
  } catch (error) {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(source.slice(start, end + 1));
      } catch {
        // Re-throw a stable error for the UI.
      }
    }
    throw new BlueprintError(`模型返回的不是合法 JSON：${error.message}`);
  }
}

function validatePlannerShape(raw, compiler) {
  const blueprint = compiler.normalizeBlueprint(raw);
  if (raw.status === "unsupported") {
    throw new BlueprintError(
      raw.reason || "Planner 判定当前数值图表达能力不能严谨覆盖该概念。",
    );
  }
  return blueprint;
}

module.exports = {
  VIEW_TYPES,
  buildPlannerUserPrompt,
  parsePlannerJson,
  plannerSystemPrompt,
  validatePlannerShape,
};
