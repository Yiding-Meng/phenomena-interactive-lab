const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";

class ProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = options.status || 502;
    this.code = options.code || "PROVIDER_ERROR";
    this.details = options.details || null;
  }
}

function providerConfig(env = process.env) {
  const apiKey =
    env.DEEPSEEK_API_KEY ||
    env.OPENAI_API_KEY ||
    env.LLM_API_KEY ||
    "";
  return {
    apiKey,
    baseUrl: (
      env.DEEPSEEK_BASE_URL ||
      env.OPENAI_BASE_URL ||
      env.LLM_BASE_URL ||
      DEFAULT_BASE_URL
    ).replace(/\/+$/, ""),
    model:
      env.PHENOMENA_LLM_MODEL ||
      env.DEEPSEEK_MODEL ||
      env.OPENAI_MODEL ||
      DEFAULT_MODEL,
    timeoutMs: Number(env.LLM_TIMEOUT_MS || 90_000),
    enabled: env.PHENOMENA_DYNAMIC !== "off",
  };
}

function completionEndpoint(baseUrl) {
  if (/\/chat\/completions$/.test(baseUrl)) return baseUrl;
  if (/\/v\d+$/.test(baseUrl)) return `${baseUrl}/chat/completions`;
  return `${baseUrl}/chat/completions`;
}

async function requestCompletion({
  systemPrompt,
  userPrompt,
  config = providerConfig(),
  fetchImpl = globalThis.fetch,
  signal,
}) {
  if (!config.apiKey) {
    throw new ProviderError(
      "未配置 LLM API Key；内置四套内核仍可正常使用。",
      { status: 503, code: "PROVIDER_NOT_CONFIGURED" },
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new ProviderError("当前运行环境没有 fetch。", {
      code: "FETCH_UNAVAILABLE",
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetchImpl(completionEndpoint(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ProviderError("LLM 返回了非 JSON 响应。", {
        details: text.slice(0, 500),
      });
    }
    if (!response.ok) {
      const message =
        payload?.error?.message ||
        `LLM 请求失败：HTTP ${response.status}`;
      throw new ProviderError(message, {
        status: response.status === 401 ? 502 : 502,
        code: "PROVIDER_HTTP_ERROR",
        details: payload?.error || null,
      });
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new ProviderError("LLM 没有返回可用的 message.content。", {
        code: "EMPTY_COMPLETION",
      });
    }
    return {
      content,
      model: payload.model || config.model,
      usage: payload.usage || null,
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error?.name === "AbortError") {
      throw new ProviderError("LLM 请求超时或被取消。", {
        status: 504,
        code: "PROVIDER_TIMEOUT",
      });
    }
    throw new ProviderError(`LLM 网络错误：${error.message}`, {
      code: "PROVIDER_NETWORK_ERROR",
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

module.exports = {
  ProviderError,
  completionEndpoint,
  providerConfig,
  requestCompletion,
};
