(function (root) {
  "use strict";

  const routes = [
    {
      domainId: "pulse",
      threshold: 2,
      keywords: [
        ["色散", 4],
        ["脉冲", 4],
        ["超短", 3],
        ["啁啾", 4],
        ["群延迟", 4],
        ["gdd", 4],
        ["tod", 3],
        ["傅里叶", 2],
        ["fft", 3],
        ["频谱", 2],
        ["波包", 2],
        ["光", 1],
        ["相位", 1],
        ["dispersion", 4],
        ["pulse", 4],
        ["chirp", 4],
        ["spectrum", 2],
        ["fourier", 2],
      ],
    },
    {
      domainId: "oscillator",
      threshold: 2,
      keywords: [
        ["振子", 4],
        ["振荡", 3],
        ["共振", 4],
        ["阻尼", 4],
        ["弹簧", 3],
        ["驱动", 2],
        ["频率响应", 3],
        ["q因子", 4],
        ["q 因子", 4],
        ["q factor", 4],
        ["受迫", 3],
        ["简谐", 3],
        ["oscillator", 4],
        ["resonance", 4],
        ["damping", 4],
        ["driven", 2],
        ["harmonic", 2],
      ],
    },
    {
      domainId: "cnn",
      threshold: 2,
      keywords: [
        ["卷积", 4],
        ["感受野", 5],
        ["神经网络", 4],
        ["特征图", 4],
        ["卷积核", 4],
        ["relu", 3],
        ["cnn", 4],
        ["kernel", 3],
        ["stride", 2],
        ["步长", 1],
        ["激活", 2],
        ["图像", 1],
        ["convolution", 4],
        ["receptive field", 5],
        ["feature map", 4],
      ],
    },
    {
      domainId: "pendulum",
      threshold: 2,
      keywords: [
        ["单摆", 5],
        ["摆角", 4],
        ["小角度", 4],
        ["非线性", 2],
        ["周期", 2],
        ["摆长", 3],
        ["重力", 2],
        ["sinθ", 3],
        ["sin theta", 3],
        ["pendulum", 5],
        ["small angle", 4],
        ["oscillation period", 2],
      ],
    },
  ];

  function normalize(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replaceAll("−", "-")
      .replaceAll("θ", "theta")
      .replace(/\s+/g, " ");
  }

  function routeConcept(text) {
    const normalized = normalize(text);
    if (!normalized) {
      return {
        domainId: null,
        confidence: 0,
        score: 0,
        matches: [],
        message: "请先输入一个概念。",
      };
    }

    const scored = routes
      .map((route) => {
        const matches = route.keywords
          .filter(([keyword]) => normalized.includes(keyword))
          .map(([keyword, weight]) => ({ keyword, weight }));
        const score = matches.reduce((sum, item) => sum + item.weight, 0);
        return { ...route, matches, score };
      })
      .sort((a, b) => b.score - a.score);

    const [best, second] = scored;
    const confidence =
      best.score > 0
        ? Math.min(
            0.99,
            best.score / Math.max(3, best.score + (second?.score || 0)),
          )
        : 0;
    const accepted = best.score >= best.threshold;

    return {
      domainId: accepted ? best.domainId : null,
      suggestedDomainId: best.score > 0 ? best.domainId : null,
      confidence: Number(confidence.toFixed(3)),
      score: best.score,
      matches: best.matches.map((item) => item.keyword),
      message: accepted
        ? `已匹配 ${best.domainId} 数值内核。`
        : best.score > 0
          ? "语义信号不足，暂不自动生成；可选择下方最接近的内核。"
          : "当前本地内核尚未覆盖这个概念。",
    };
  }

  function getKnownRoute(text) {
    const result = routeConcept(text);
    return result.domainId
      ? routes.find((route) => route.domainId === result.domainId) || null
      : null;
  }

  function isKnownConcept(text) {
    return Boolean(getKnownRoute(text));
  }

  const api = { getKnownRoute, isKnownConcept, normalize, routeConcept, routes };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConceptRouter = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
