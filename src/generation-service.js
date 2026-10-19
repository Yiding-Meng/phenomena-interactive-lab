const {
  BlueprintError,
  compileBlueprint,
  normalizeBlueprint,
} = require("./blueprint-compiler.js");
const {
  buildPlannerUserPrompt,
  parsePlannerJson,
  plannerSystemPrompt,
  validatePlannerShape,
} = require("./blueprint-schema.js");
const {
  ProviderError,
  providerConfig,
  requestCompletion,
} = require("./llm-provider.js");
const {
  listGoldenExamples,
  selectGoldenExample,
} = require("../examples/golden/index.js");
const conceptRouter = require("./routing.js");

function dynamicStatus(env = process.env) {
  const config = providerConfig(env);
  return {
    enabled: config.enabled,
    configured: Boolean(config.apiKey),
    model: config.model,
    provider: config.baseUrl.includes("deepseek")
      ? "DeepSeek"
      : "OpenAI-compatible",
    examples: listGoldenExamples(),
  };
}

async function generateBlueprint({
  text,
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal,
  completion = requestCompletion,
}) {
  const concept = String(text || "").trim();
  if (!concept) {
    throw new BlueprintError("请先输入一个概念。", "text");
  }
  if (concept.length > 500) {
    throw new BlueprintError("概念描述不能超过 500 个字符。", "text");
  }
  const config = providerConfig(env);
  if (!config.enabled) {
    throw new ProviderError("动态生成已通过 PHENOMENA_DYNAMIC=off 关闭。", {
      status: 503,
      code: "DYNAMIC_DISABLED",
    });
  }
  if (!config.apiKey && completion === requestCompletion) {
    throw new ProviderError(
      "未配置 DEEPSEEK_API_KEY；内置四套数值仪器仍可正常使用。",
      { status: 503, code: "PROVIDER_NOT_CONFIGURED" },
    );
  }
  const example = selectGoldenExample(concept);
  const startedAt = Date.now();
  const response = await completion({
    systemPrompt: plannerSystemPrompt(),
    userPrompt: buildPlannerUserPrompt(concept, example),
    config,
    fetchImpl,
    signal,
  });
  const rawBlueprint = parsePlannerJson(response.content);
  if (rawBlueprint.status === "unsupported") {
    throw new BlueprintError(
      rawBlueprint.reason ||
        "Planner 判定当前安全表达式图不能严谨表达该概念。",
    );
  }
  validatePlannerShape(rawBlueprint, { normalizeBlueprint });
  const domain = compileBlueprint(rawBlueprint, { index: "DYN" });
  const defaults = Object.fromEntries(
    domain.controls.map((control) => [control.id, control.default]),
  );
  const result = domain.compute(defaults);
  const boundary = {
    min: Object.fromEntries(
      domain.controls.map((control) => [control.id, control.min]),
    ),
    max: Object.fromEntries(
      domain.controls.map((control) => [control.id, control.max]),
    ),
  };
  const boundaryResults = [
    domain.compute(boundary.min),
    domain.compute(boundary.max),
  ];
  const finite =
    result.checks.finite &&
    boundaryResults.every((item) => item.checks.finite);
  if (!finite) {
    throw new BlueprintError(
      "生成的动态图在默认或边界参数下产生了 NaN / Infinity。",
    );
  }
  return {
    concept,
    exampleId: example.id,
    model: response.model,
    usage: response.usage,
    durationMs: Date.now() - startedAt,
    blueprint: JSON.parse(
      JSON.stringify({
        ...domain.blueprint,
        status: "supported",
        _compiled: undefined,
      }),
    ),
    domain: serializableDomain(domain),
    preview: {
      defaultTrace: result.metrics.outputSpan,
      minTrace: boundaryResults[0].metrics.outputSpan,
      maxTrace: boundaryResults[1].metrics.outputSpan,
      boundaryDiffers:
        boundaryResults[0].metrics.outputSpan !== boundaryResults[1].metrics.outputSpan,
    },
  };
}

function serializableDomain(domain) {
  return {
    id: domain.id,
    index: domain.index,
    name: domain.name,
    shortName: domain.shortName,
    subtitle: domain.subtitle,
    question: domain.question,
    goal: domain.goal,
    equations: domain.equations,
    algorithm: domain.algorithm,
    helpers: domain.helpers,
    palette: domain.palette,
    controls: domain.controls,
    presets: domain.presets,
    views: domain.views,
    metrics: domain.metrics,
    presetGlow: domain.presetGlow,
  };
}

function generationErrorPayload(error) {
  if (error instanceof BlueprintError) {
    return {
      status: 422,
      code: "INVALID_BLUEPRINT",
      message: error.message,
      field: error.path || null,
    };
  }
  if (error instanceof ProviderError) {
    return {
      status: error.status || 502,
      code: error.code || "PROVIDER_ERROR",
      message: error.message,
      details: error.details || null,
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: error?.message || "动态生成失败。",
  };
}

function routeKnownConcept(text) {
  return conceptRouter.routeConcept(text);
}

module.exports = {
  dynamicStatus,
  generateBlueprint,
  generationErrorPayload,
  routeKnownConcept,
  serializableDomain,
};
