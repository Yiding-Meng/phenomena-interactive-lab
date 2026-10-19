(function () {
  "use strict";

  const state = {
    domainId: "pulse",
    params: {},
    presetId: "transform-limited",
    result: null,
    baselineDomain: null,
    activeRun: null,
    viewMode: "primary",
    isPlaying: false,
    playFrame: null,
    playStartedAt: 0,
    playStartGdd: 0,
    runCounter: 0,
    inspectorVisible: false,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    lastRenderSignature: "",
  };

  const elements = {};
  let chartResizeObserver = null;

  document.addEventListener("DOMContentLoaded", boot);

  function boot() {
    cacheElements();
    buildDomainSwitcher();
    bindChromeEvents();
    selectDomain(state.domainId, { animate: true });
    exposeController();
    setupResizeObserver();
    window.__APP_READY__ = true;
    document.body.classList.add("is-ready");
  }

  function cacheElements() {
    elements.body = document.body;
    elements.sidebar = document.querySelector("[data-sidebar]");
    elements.domainList = document.querySelector("[data-domain-list]");
    elements.domainEyebrow = document.querySelector("[data-domain-eyebrow]");
    elements.domainTitle = document.querySelector("[data-domain-title]");
    elements.domainSubtitle = document.querySelector("[data-domain-subtitle]");
    elements.domainIndex = document.querySelector("[data-domain-index]");
    elements.question = document.querySelector("[data-question]");
    elements.goal = document.querySelector("[data-goal]");
    elements.formula = document.querySelector("[data-formula]");
    elements.formulaSecondary = document.querySelector("[data-formula-secondary]");
    elements.algorithm = document.querySelector("[data-algorithm]");
    elements.helpers = document.querySelector("[data-helpers]");
    elements.controls = document.querySelector("[data-controls]");
    elements.presets = document.querySelector("[data-presets]");
    elements.insight = document.querySelector("[data-insight]");
    elements.metricStrip = document.querySelector("[data-metric-strip]");
    elements.plotTitle = document.querySelector("[data-plot-title]");
    elements.plotMode = document.querySelector("[data-plot-mode]");
    elements.activeState = document.querySelector("[data-active-state]");
    elements.primaryCanvas = document.querySelector("[data-primary-canvas]");
    elements.secondaryCanvas = document.querySelector("[data-secondary-canvas]");
    elements.secondaryPanel = document.querySelector("[data-secondary-panel]");
    elements.secondaryLabel = document.querySelector("[data-secondary-label]");
    elements.secondaryLegend = document.querySelector("[data-secondary-legend]");
    elements.primaryLegend = document.querySelector("[data-primary-legend]");
    elements.primaryViewLabel = document.querySelector("[data-primary-view-label]");
    elements.phaseCanvas = document.querySelector("[data-phase-canvas]");
    elements.playButton = document.querySelector("[data-play]");
    elements.resetButton = document.querySelector("[data-reset]");
    elements.exportButton = document.querySelector("[data-export]");
    elements.auditButton = document.querySelector("[data-audit]");
    elements.auditPanel = document.querySelector("[data-audit-panel]");
    elements.auditResults = document.querySelector("[data-audit-results]");
    elements.auditSummary = document.querySelector("[data-audit-summary]");
    elements.auditStatus = document.querySelector("[data-audit-status]");
    elements.auditClose = document.querySelector("[data-audit-close]");
    elements.liveStatus = document.querySelector("[data-live-status]");
    elements.consoleStream = document.querySelector("[data-console-stream]");
    elements.ambient = document.querySelector("[data-ambient]");
    elements.exportDialog = document.querySelector("[data-export-dialog]");
    elements.exportCode = document.querySelector("[data-export-code]");
    elements.exportConfirm = document.querySelector("[data-export-confirm]");
    elements.exportCopy = document.querySelector("[data-export-copy]");
    elements.exportClose = document.querySelector("[data-export-close]");
    elements.toast = document.querySelector("[data-toast]");
    elements.intuitionBadge = document.querySelector("[data-intuition-badge]");
    elements.intuitionText = document.querySelector("[data-intuition-text]");
    elements.conceptForm = document.querySelector("[data-concept-form]");
    elements.conceptInput = document.querySelector("[data-concept-input]");
    elements.conceptHint = document.querySelector("[data-concept-hint]");
    elements.generationStatus = document.querySelector("[data-generation-status]");
    elements.generationStatusText = document.querySelector(
      "[data-generation-status-text]",
    );
  }

  function domain() {
    return window.Domains.getDomain(state.domainId);
  }

  function buildDomainSwitcher() {
    elements.domainList.innerHTML = window.Domains.listDomains()
      .map(
        (item, index) => `
          <button class="domain-card" data-domain-id="${item.id}" type="button" aria-pressed="false">
            <span class="domain-card__index">${item.index}</span>
            <span class="domain-card__body">
              <span class="domain-card__name">${item.name}</span>
              <span class="domain-card__sub">${item.subtitle}</span>
            </span>
            <span class="domain-card__dot" style="--domain-color:${item.palette[0]}"></span>
          </button>
        `,
      )
      .join("");

    elements.domainList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-domain-id]");
      if (!button) return;
      selectDomain(button.dataset.domainId, { animate: true });
    });
  }

  function rebuildDomainSwitcher() {
    elements.domainList.innerHTML = "";
    buildDomainSwitcher();
  }

  function bindChromeEvents() {
    elements.playButton.addEventListener("click", togglePlay);
    elements.resetButton.addEventListener("click", () => {
      const currentDomain = domain();
      const initialPreset = currentDomain.presets[0];
      setParams(window.Domains.presetParams(currentDomain, initialPreset.id), {
        presetId: initialPreset.id,
        source: "reset",
      });
    });
    elements.exportButton.addEventListener("click", openExportDialog);
    elements.exportClose.addEventListener("click", closeExportDialog);
    elements.exportConfirm.addEventListener("click", downloadExport);
    elements.exportCopy.addEventListener("click", copyExport);
    elements.auditButton.addEventListener("click", openAuditPanel);
    elements.auditClose.addEventListener("click", closeAuditPanel);
    elements.exportDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeExportDialog();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (elements.exportDialog.open) closeExportDialog();
        if (elements.auditPanel.classList.contains("is-open")) closeAuditPanel();
      }
    });
    window.addEventListener("resize", debounce(() => renderCurrent(), 80));
    elements.conceptForm.addEventListener("submit", handleConceptRouting);
    loadGenerationStatus();
  }

  async function loadGenerationStatus() {
    if (window.location.protocol === "file:") {
      elements.generationStatusText.textContent =
        "本地离线模式 · 内置模型可直接使用；动态生成请运行 npm start";
      elements.generationStatus.classList.add("is-ready");
      return;
    }
    try {
      const response = await fetch("/api/status", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const status = await response.json();
      if (status.configured && status.enabled) {
        elements.generationStatusText.textContent =
          `${status.provider} · ${status.model} · 动态蓝图已连接`;
        elements.generationStatus.classList.add("is-ready");
      } else {
        elements.generationStatusText.textContent =
          "动态生成待配置 · 内置四套内核可离线使用";
        elements.generationStatus.classList.add("is-ready");
      }
    } catch {
      elements.generationStatusText.textContent =
        "本地静态模式 · 浏览器质检与离线导出仍可用";
      elements.generationStatus.classList.add("is-error");
    }
  }

  function setGenerationStatus(text, tone) {
    elements.generationStatusText.textContent = text;
    elements.generationStatus.classList.remove("is-running", "is-ready", "is-error");
    if (tone) elements.generationStatus.classList.add(tone);
  }

  async function handleConceptRouting(event) {
    event.preventDefault();
    const text = elements.conceptInput.value.trim();
    if (window.ConceptRouter.isKnownConcept(text)) {
      const result = window.ConceptRouter.routeConcept(text);
      elements.conceptHint.textContent = result.message;
      elements.conceptHint.classList.remove("is-warning");
      selectDomain(result.domainId, { animate: true });
      elements.conceptHint.textContent =
        `${result.message} 命中：${result.matches.join(" / ")}。`;
      elements.conceptInput.blur();
      return;
    }
    const result = window.ConceptRouter.routeConcept(text);
    if (result.suggestedDomainId) {
      const suggestion = window.Domains.getDomain(result.suggestedDomainId);
      elements.conceptHint.textContent += ` 最接近：${suggestion.name}。`;
    }
    await generateDynamicInstrument(text);
  }

  async function generateDynamicInstrument(text) {
    if (window.location.protocol === "file:") {
      elements.conceptHint.textContent =
        "当前是直接打开的单文件模式。动态生成需要运行 npm start 启动本地服务。";
      elements.conceptHint.classList.add("is-warning");
      setGenerationStatus("离线模式 · 动态 Planner 未连接", "is-error");
      return;
    }
    const submit = elements.conceptForm.querySelector("[type='submit']");
    const originalLabel = submit.innerHTML;
    submit.disabled = true;
    submit.innerHTML = "Planner 生成中 <span>···</span>";
    setGenerationStatus(
      "调用 Planner → 白名单编译 → 边界探针…",
      "is-running",
    );
    appendConsoleLine(
      `planner request  concept="${text.slice(0, 80)}"`,
      "accent",
    );
    elements.conceptHint.classList.remove("is-warning");
    elements.conceptHint.textContent =
      "本地内核未覆盖，正在尝试生成可验证的动态蓝图。";
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ concept: text }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || `HTTP ${response.status}`);
      }
      const domain = await registerGeneratedBlueprint(payload.blueprint, payload);
      elements.conceptHint.textContent =
        `动态蓝图已编译 · ${payload.model || "Planner"} · 黄金样本 ${payload.exampleId} · ${Math.round(payload.durationMs || 0)} ms`;
      elements.conceptHint.classList.remove("is-warning");
      appendConsoleLine(
        `dynamic compile  ${domain.id}  ·  ${domain.controls.length} controls  ·  boundary PASS`,
        "accent",
      );
      elements.conceptInput.value = "";
      elements.conceptInput.blur();
    } catch (error) {
      elements.conceptHint.textContent =
        `动态生成未通过：${error.message}`;
      elements.conceptHint.classList.add("is-warning");
      setGenerationStatus("生成未通过 · 现有内核未受影响", "is-error");
    } finally {
      submit.disabled = false;
      submit.innerHTML = originalLabel;
    }
  }

  async function registerGeneratedBlueprint(blueprint, meta = {}) {
    const domain = window.PhenomenaCompiler.compileBlueprint(blueprint, {
      index: "DYN",
    });
    window.Domains.registerDynamicDomain(domain);
    rebuildDomainSwitcher();
    selectDomain(domain.id, { animate: true });
    elements.conceptHint.classList.remove("is-warning");
    setGenerationStatus(
      `动态内核 ${domain.id} · 边界探针通过`,
      "is-ready",
    );
    if (meta.model || meta.exampleId) {
      elements.conceptHint.textContent =
        `动态蓝图已编译 · ${meta.model || "Planner"} · 黄金样本 ${meta.exampleId || "fixture"} · ${Math.round(meta.durationMs || 0)} ms`;
    }
    return domain;
  }

  function setupResizeObserver() {
    if (!("ResizeObserver" in window)) return;
    chartResizeObserver = new ResizeObserver(
      debounce(() => {
        if (state.result) renderCurrent();
      }, 70),
    );
      [elements.primaryCanvas, elements.secondaryCanvas, elements.phaseCanvas].forEach(
      (canvas) => chartResizeObserver.observe(canvas.parentElement),
    );
  }

  function selectDomain(domainId, options = {}) {
    stopPlayback();
    state.domainId = domainId;
    const currentDomain = domain();
    const initialPreset = currentDomain.presets[0];
    state.params = window.Domains.presetParams(currentDomain, initialPreset.id);
    state.presetId = initialPreset.id;
    state.baselineDomain = currentDomain;
    state.resumePresetId = "";
    state.resumeParams = null;
    state.viewMode = currentDomain.id === "pendulum" ? "primary" : "primary";
    elements.body.dataset.domain = currentDomain.id;
    elements.body.style.setProperty("--accent", currentDomain.palette[0]);
    elements.body.style.setProperty("--accent-soft", hexToRgba(currentDomain.palette[0], 0.16));
    elements.body.style.setProperty("--accent-faint", hexToRgba(currentDomain.palette[0], 0.08));
    document.querySelectorAll("[data-domain-id]").forEach((button) => {
      const active = button.dataset.domainId === currentDomain.id;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
    });
    applyDomainCopy(currentDomain);
    renderControls(currentDomain);
    renderPresets(currentDomain);
    renderHelpers(currentDomain);
    computeAndRender({ source: options.animate ? "domain" : "init" });
    if (options.animate && !state.reducedMotion) {
      elements.body.classList.remove("domain-transition");
      void elements.body.offsetWidth;
      elements.body.classList.add("domain-transition");
    }
  }

  function applyDomainCopy(currentDomain) {
    elements.domainEyebrow.textContent = currentDomain.shortName;
    elements.domainTitle.textContent = currentDomain.name;
    elements.domainSubtitle.textContent = currentDomain.subtitle;
    elements.domainIndex.textContent = currentDomain.index;
    elements.question.textContent = currentDomain.question;
    elements.goal.textContent = currentDomain.goal;
    elements.formula.innerHTML = "";
    elements.formulaSecondary.innerHTML = "";
    renderEquation(elements.formula, currentDomain.equations[0], true);
    if (currentDomain.equations[1]) {
      renderEquation(elements.formulaSecondary, currentDomain.equations[1], false);
    }
    elements.algorithm.textContent = currentDomain.algorithm;
    elements.plotTitle.textContent = currentDomain.views[0].label;
    elements.primaryViewLabel.textContent = currentDomain.views[0].type.replaceAll("_", " ");
    elements.plotMode.textContent = elements.primaryViewLabel.textContent;
    elements.primaryLegend.innerHTML = legendMarkup([
      { color: "#71847e", label: "初始参考基线", dash: true },
      { color: currentDomain.palette[0], label: "当前响应", glow: true },
    ]);
      elements.secondaryLabel.textContent =
        currentDomain.views[1]?.label || "相位空间";
    elements.secondaryLegend.innerHTML = legendMarkup([
      { color: "#71847e", label: "参考", dash: true },
      { color: currentDomain.palette[2] || currentDomain.palette[0], label: "当前", glow: true },
    ]);
    elements.secondaryPanel.classList.toggle(
      "is-hidden",
      currentDomain.views[1]?.type === "Grid_Heatmap",
    );
    const secondaryCanvas = document.querySelector("[data-secondary-canvas]");
    if (secondaryCanvas) secondaryCanvas.style.display = "block";
    togglePhasePanel(currentDomain.id === "pendulum");
    elements.metricStrip.innerHTML = "";
    elements.insight.textContent = currentDomain.goal;
    elements.plotMode.textContent = elements.primaryViewLabel.textContent;
  }

  function legendMarkup(items) {
    return items
      .map(
        (item) => `
          <span class="legend-item">
            <span class="legend-swatch ${item.dash ? "is-dashed" : ""} ${item.glow ? "is-glow" : ""}" style="--swatch:${item.color}"></span>
            ${item.label}
          </span>
        `,
      )
      .join("");
  }

  function renderEquation(target, latex, display) {
    const wrapper = document.createElement(display ? "div" : "span");
    wrapper.className = display ? "equation equation--display" : "equation equation--inline";
    target.appendChild(wrapper);
    if (window.katex) {
      try {
        window.katex.render(latex, wrapper, {
          throwOnError: false,
          displayMode: display,
          trust: false,
          strict: "ignore",
        });
        return;
      } catch (error) {
        wrapper.textContent = latex;
        return;
      }
    }
    const fallback = document.createElement("span");
    fallback.className = "equation__fallback";
    fallback.textContent = latex
      .replaceAll("\\mathcal{F}", "F")
      .replaceAll("\\mathrm", "")
      .replaceAll("\\left", "")
      .replaceAll("\\right", "")
      .replace(/\\([a-zA-Z]+)/g, "$1")
      .replaceAll("{", "")
      .replaceAll("}", "");
    wrapper.appendChild(fallback);
  }

  function renderHelpers(currentDomain) {
    elements.helpers.innerHTML = currentDomain.helpers
      .map((helper) => `<span class="helper-chip">SIM.${helper}()</span>`)
      .join("");
  }

  function renderControls(currentDomain) {
    elements.controls.innerHTML = currentDomain.controls
      .map((control) => {
        const value = state.params[control.id];
        return `
          <div class="control-row" data-control-row="${control.id}">
            <div class="control-row__header">
              <label for="control-${control.id}">
                <span class="control-symbol">${control.symbol}</span>
                <span class="control-label">${control.label}</span>
              </label>
              <span class="control-value" data-value-for="${control.id}">${formatControlValue(value, control)}</span>
            </div>
            <div class="control-row__track">
              <input
                id="control-${control.id}"
                data-control="${control.id}"
                type="range"
                min="${control.min}"
                max="${control.max}"
                step="${control.step}"
                value="${value}"
                aria-label="${control.label}"
              />
            </div>
            <div class="control-row__scale">
              <span>${formatControlValue(control.min, control)}</span>
              <span>${control.effect}</span>
              <span>${formatControlValue(control.max, control)}</span>
            </div>
          </div>
        `;
      })
      .join("");

    elements.controls.querySelectorAll("[data-control]").forEach((input) => {
      input.addEventListener("input", (event) => {
        const controlId = event.target.dataset.control;
        const control = currentDomain.controls.find((item) => item.id === controlId);
        const next = { ...state.params, [controlId]: Number(event.target.value) };
        state.params = window.Domains.normalizeParams(currentDomain, next);
        syncPresetFromParams(currentDomain);
        updateControlValues(currentDomain);
        updatePresetSelection();
        computeAndRender({ source: "control", controlId });
      });
      input.addEventListener("pointerdown", () => stopPlayback());
    });
  }

  function renderPresets(currentDomain) {
    elements.presets.innerHTML = currentDomain.presets
      .map(
        (preset, index) => `
          <button
            class="preset-card ${preset.id === state.presetId ? "is-active" : ""}"
            data-preset="${preset.id}"
            type="button"
            style="--preset-index:${index}"
          >
            <span class="preset-card__top">
              <span class="preset-card__tag">${preset.tag}</span>
              <span class="preset-card__arrow">↗</span>
            </span>
            <span class="preset-card__name">${preset.name}</span>
            <span class="preset-card__description">${preset.description}</span>
          </button>
        `,
      )
      .join("");

    elements.presets.querySelectorAll("[data-preset]").forEach((button) => {
      button.addEventListener("click", () => {
        stopPlayback();
        applyPreset(button.dataset.preset);
      });
    });
  }

  function applyPreset(presetId) {
    const currentDomain = domain();
    const preset = window.Domains.resolvePreset(currentDomain, presetId);
    state.presetId = preset.id;
    setParams(window.Domains.presetParams(currentDomain, preset.id), {
      presetId: preset.id,
      source: "preset",
    });
  }

  function setParams(params, options = {}) {
    state.params = window.Domains.normalizeParams(domain(), params);
    if (options.presetId !== undefined) state.presetId = options.presetId;
    updateControlValues(domain());
    updatePresetSelection();
    computeAndRender({ source: options.source || "setParams" });
  }

  function syncPresetFromParams(currentDomain) {
    const matched = currentDomain.presets.find((preset) => {
      const values = window.Domains.presetParams(currentDomain, preset.id);
      return currentDomain.controls.every(
        (control) =>
          Math.abs(values[control.id] - state.params[control.id]) < 1e-9,
      );
    });
    state.presetId = matched?.id || "";
  }

  function updateControlValues(currentDomain) {
    for (const control of currentDomain.controls) {
      const value = state.params[control.id];
      const input = elements.controls.querySelector(`[data-control="${control.id}"]`);
      if (input) input.value = value;
      const output = elements.controls.querySelector(`[data-value-for="${control.id}"]`);
      if (output) output.textContent = formatControlValue(value, control);
      const progress = ((value - control.min) / (control.max - control.min)) * 100;
      input?.style.setProperty("--range-progress", `${progress}%`);
    }
  }

  function updatePresetSelection() {
    elements.presets.querySelectorAll("[data-preset]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.preset === state.presetId);
    });
  }

  function formatControlValue(value, control) {
    const decimals = control.step < 0.1 ? 2 : control.step < 1 ? 1 : 0;
    return `${Number(value).toFixed(decimals)}${control.unit ? ` ${control.unit}` : ""}`;
  }

  function computeAndRender(options = {}) {
    try {
      const result = domain().compute(state.params);
      state.result = result;
      renderCurrent();
      updateMetrics(result);
      updateInsight(result);
      if (options.source !== "audit" && options.source !== "remote") {
        updateConsole(result, options);
      }
      elements.liveStatus.textContent =
        domain().id === "pulse" ? "NUMERIC" : "LIVE";
      elements.liveStatus.classList.remove("is-warning");
    } catch (error) {
      reportRuntimeError(error);
    }
  }

  function renderCurrent() {
    if (!state.result) return;
    const result = state.result;
    const currentDomain = domain();
    const stage = elements.primaryCanvas.parentElement;
    if (!stage.clientWidth || !stage.clientHeight) return;
    const width = Math.max(320, stage.clientWidth);
    const height = Math.max(280, stage.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (currentDomain.dynamic) {
      const primarySeries = dynamicPrimarySeries(currentDomain, result);
      const baselineDomain = state.baselineDomain;
      const baseline =
        currentDomain.presets[0] &&
        baselineDomain?.compute(baselineDomain.presets[0].params);
      const baselineSeries =
        baseline ? dynamicPrimarySeries(currentDomain, baseline) : [];
      window.PhenomenaChart.renderPlot(elements.primaryCanvas, {
        width,
        height,
        dpr,
        series: [
          {
            values: baselineSeries,
            x: baseline?.x,
            color: "#71847e",
            width: 1.2,
            alpha: 0.62,
            dash: [6, 6],
          },
          {
            values: primarySeries,
            x: result.x,
            color: currentDomain.palette[0],
            width: 1.8,
            glow: `${currentDomain.palette[0]}55`,
            fill: `${currentDomain.palette[0]}12`,
          },
        ],
        xDomain: result.axes.xRange,
        yDomain: result.axes.yRange,
        xLabel: result.axes.xLabel,
        yLabel: result.axes.yLabel,
      });
      const secondaryStage = elements.secondaryCanvas.parentElement;
      if (secondaryStage) {
        elements.secondaryPanel.classList.remove("is-hidden");
        elements.secondaryCanvas.style.display = "block";
        elements.secondaryLabel.textContent = "参数—输出关系";
        const control = currentDomain.controls[0];
        const sweep = [];
        const sweepParams = { ...state.params };
        const sweepCount = 80;
        for (let index = 0; index < sweepCount; index += 1) {
          sweepParams[control.id] =
            control.min + ((control.max - control.min) * index) / (sweepCount - 1);
          const next = currentDomain.compute(sweepParams);
          sweep.push(
            next.metrics.outputPeak * 0.6 +
              next.metrics.outputMean * 0.4,
          );
        }
        window.PhenomenaChart.renderPlot(elements.secondaryCanvas, {
          width: Math.max(320, secondaryStage.clientWidth || width),
          height: Math.max(180, secondaryStage.clientHeight || height),
          dpr,
          series: [
            {
              values: sweep,
              color: currentDomain.palette[1],
              width: 1.6,
              glow: `${currentDomain.palette[1]}44`,
            },
          ],
          xDomain: [control.min, control.max],
          xLabel: `${control.label} / ${control.unit || "a.u."}`,
          yLabel: "响应强度",
          marker: {
            x: state.params[control.id],
            color: currentDomain.palette[0],
          },
        });
      }
      return;
    }
    elements.secondaryCanvas.parentElement
      .querySelector(".dynamic-sweep-marker")
      ?.remove();
    const secondaryStage = elements.secondaryCanvas.parentElement;
    const secondaryWidth = Math.max(320, secondaryStage.clientWidth || width);
    const secondaryHeight = Math.max(
      180,
      secondaryStage.clientHeight || height,
    );

    if (currentDomain.id === "cnn") {
      elements.secondaryCanvas
        .closest(".plot-card--secondary")
        ?.classList.add("is-hidden");
      elements.secondaryCanvas.style.display = "none";
      window.PhenomenaChart.renderGridWithProbe(
        elements.primaryCanvas,
        result,
        {
          width,
          height,
          dpr,
          onProbeChange: (probe) => {
            if (!probe) return;
            if (probe.panel === "kernel") {
              elements.plotMode.textContent =
                `KERNEL ${probe.row}:${probe.column} · ${probe.weight.toFixed(3)}`;
              return;
            }
            elements.plotMode.textContent =
              `PROBE ${probe.outputColumn}:${probe.outputRow} · Σ ${probe.preActivation.toFixed(3)}`;
          },
        },
      );
      elements.secondaryCanvas.parentElement
        .querySelector(".dynamic-sweep-marker")
        ?.remove();
      return;
    }

    elements.secondaryCanvas
      .closest(".plot-card--secondary")
      ?.classList.remove("is-hidden");

    if (currentDomain.id === "pendulum") {
      window.PhenomenaChart.renderPlot(
        elements.primaryCanvas,
        plotConfigFor(currentDomain, result, width, height, dpr),
      );
      window.PhenomenaChart.renderPhaseSpaceTrajectory(
        elements.secondaryCanvas,
        result,
        { width: secondaryWidth, height: secondaryHeight, dpr },
      );
      elements.secondaryPanel.classList.remove("is-hidden");
      elements.secondaryLabel.textContent = "相空间轨迹";
      elements.secondaryLegend.innerHTML = legendMarkup([
        { color: "#71847e", label: "线性参考", dash: true },
        { color: "#7cf7d4", label: "时间起点", glow: true },
        { color: "#ff9e8a", label: "时间终点", glow: true },
      ]);
      return;
    }

    const plotOptions = plotConfigFor(currentDomain, result, width, height, dpr);
    window.PhenomenaChart.renderPlot(elements.primaryCanvas, plotOptions);

    if (currentDomain.id === "pulse") {
      const spectrumConfig = {
        width: secondaryWidth,
        height: secondaryHeight,
        dpr,
        series: [
          {
            values: result.series.spectrumBaseline,
            axis: "left",
            color: "#71847e",
            width: 1.2,
            alpha: 0.58,
            dash: [5, 5],
          },
          {
            values: result.series.spectrum,
            axis: "left",
            color: currentDomain.palette[2],
            width: 1.7,
            glow: "rgba(255,187,107,.32)",
          },
          {
            values: result.series.phase,
            axis: "right",
            color: currentDomain.palette[1],
            width: 1.15,
            alpha: 0.7,
          },
        ],
        xDomain: [result.axes.secondaryXRange[0], result.axes.secondaryXRange[1]],
        xLabel: result.axes.secondaryXLabel,
        yLabel: "归一化频谱",
        rightLabel: "相位 φ(ω) / rad",
        yDomain: [0, 1.12],
        rightAxis: (() => {
          const phaseValues = result.series.phase.filter((value) => value !== null);
          const phaseMin = phaseValues.length ? Math.min(...phaseValues) : -8;
          const phaseMax = phaseValues.length ? Math.max(...phaseValues) : 8;
          return [Math.min(-8, phaseMin * 1.15), Math.max(8, phaseMax * 1.15)];
        })(),
      };
      window.PhenomenaChart.renderPlot(elements.secondaryCanvas, spectrumConfig);
    }

    if (currentDomain.id === "oscillator") {
      window.PhenomenaChart.renderPlot(elements.secondaryCanvas, {
        width: secondaryWidth,
        height: secondaryHeight,
        dpr,
        series: [
          {
            values: result.series.resonanceBaseline,
            axis: "left",
            color: "#71847e",
            width: 1.2,
            alpha: 0.68,
            dash: [5, 5],
          },
          {
            values: result.series.resonanceCurve,
            axis: "left",
            color: currentDomain.palette[1],
            width: 1.8,
            glow: "rgba(124,247,212,.3)",
            fill: "rgba(124,247,212,.12)",
          },
        ],
        xDomain: [0.35, 2.8],
        xLabel: "驱动角频率 ω_d (rad/s)",
        yLabel: "归一化振幅",
        yDomain: [0, 1.1],
        marker: { x: state.params.driveFreq, color: currentDomain.palette[0] },
      });
    }

  }

  function dynamicPrimarySeries(currentDomain, result) {
    const view =
      currentDomain.views?.[0] ||
      currentDomain.blueprint?.visual_views?.[0] ||
      {};
    return (
      result?.series?.[view.seriesId] ||
      result?.series?.[view.series_id] ||
      Object.entries(result?.series || {}).find(
        ([key]) => key !== "baseline" && key !== "current",
      )?.[1] ||
      result?.series?.current ||
      []
    );
  }

  function plotConfigFor(currentDomain, result, width, height, dpr) {
    if (currentDomain.id === "pulse") {
      return {
        width,
        height,
        dpr,
        series: [
          {
            values: result.series.baseline,
            axis: "left",
            color: "#71847e",
            width: 1.35,
            alpha: 0.72,
            dash: [6, 6],
          },
          {
            values: result.series.current,
            axis: "left",
            color: currentDomain.palette[0],
            width: 2,
            glow: "rgba(124,247,212,.5)",
            fill: "rgba(124,247,212,.1)",
          },
        ],
        xDomain: result.axes.xRange,
        yDomain: result.axes.yRange,
        xLabel: result.axes.xLabel,
        yLabel: result.axes.yLabel,
        callout: {
          x: result.x[result.series.current.indexOf(Math.max(...result.series.current))],
          y: 1,
          text: `FWHM ${result.metrics.fwhm.toFixed(1)} fs · ${result.metrics.broadening.toFixed(2)}×`,
          color: currentDomain.palette[0],
        },
      };
    }

    if (currentDomain.id === "oscillator") {
      const yMax = Math.max(1.5, ...result.series.current.map(Math.abs), ...result.series.baseline.map(Math.abs)) * 1.08;
      return {
        width,
        height,
        dpr,
        series: [
          {
            values: result.series.baseline,
            axis: "left",
            color: "#71847e",
            width: 1.2,
            alpha: 0.62,
            dash: [6, 6],
          },
          {
            values: result.series.current,
            axis: "left",
            color: currentDomain.palette[0],
            width: 1.7,
            glow: "rgba(255,207,112,.38)",
            fill: "rgba(255,207,112,.055)",
          },
        ],
        xDomain: result.axes.xRange,
        yDomain: [-yMax, yMax],
        xLabel: result.axes.xLabel,
        yLabel: result.axes.yLabel,
      };
    }

    if (currentDomain.id === "pendulum") {
      return {
        width,
        height,
        dpr,
        series: [
          {
            values: result.series.baseline,
            axis: "left",
            color: "#71847e",
            width: 1.2,
            alpha: 0.62,
            dash: [6, 6],
          },
          {
            values: result.series.current,
            axis: "left",
            color: currentDomain.palette[0],
            width: 1.75,
            glow: "rgba(255,158,138,.36)",
          },
        ],
        xDomain: result.axes.xRange,
        yDomain: [-2.8, 2.8],
        xLabel: result.axes.xLabel,
        yLabel: result.axes.yLabel,
      };
    }

    return {
      width,
      height,
      dpr,
      series: [],
      xDomain: [0, 1],
      yDomain: [0, 1],
    };
  }

  function updateMetrics(result) {
    const currentDomain = domain();
    elements.metricStrip.innerHTML = currentDomain.metrics
      .map((metric) => {
        const raw = result.metrics[metric.key];
        let display = raw;
        let unit = metric.unit;
        if (metric.key === "activationFraction") display = raw * 100;
        if (metric.key === "periodError") display = raw * 100;
        if (metric.key === "estimatedPeriod") unit = "s";
        return `
          <div class="metric-cell">
            <span class="metric-label">${metric.label}</span>
            <span class="metric-value">${formatMetric(display, metric.digits)}<span class="metric-unit">${unit}</span></span>
          </div>
        `;
      })
      .join("");
  }

  function updateInsight(result) {
    elements.insight.textContent = result.insight;
    elements.intuitionBadge.textContent = state.presetId
      ? window.Domains.resolvePreset(domain(), state.presetId).tag
      : "FREE DRIVE";
    elements.intuitionText.textContent = result.insight;
    elements.activeState.textContent = state.presetId
      ? window.Domains.resolvePreset(domain(), state.presetId).name
      : "自定义参数";
  }

  function formatMetric(value, digits = 2) {
    if (!Number.isFinite(value)) return "—";
    const absolute = Math.abs(value);
    if (absolute >= 1000) return value.toExponential(2);
    return value.toFixed(digits);
  }

  function updateConsole(result, options) {
    const checksum = resultChecksum(result);
    const currentDomain = domain();
    const metricText = currentDomain.metrics
      .slice(0, 2)
      .map((metric) => {
        const value = result.metrics[metric.key];
        return `${metric.key}=${Number.isFinite(value) ? Number(value).toFixed(3) : "ERR"}`;
      })
      .join(" · ");
    appendConsoleLine(
      `${String(++state.runCounter).padStart(2, "0")}  ${options.source || "render"}  ${metricText}  ·  trace ${checksum}`,
      options.source === "preset" ? "accent" : "",
    );
  }

  function appendConsoleLine(text, tone) {
    const line = document.createElement("div");
    line.className = `console-line ${tone ? `is-${tone}` : ""}`;
    const timestamp = new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    line.innerHTML = `<span class="console-time">${timestamp}</span><span>${escapeHtml(text)}</span>`;
    elements.consoleStream.prepend(line);
    while (elements.consoleStream.children.length > 5) {
      elements.consoleStream.lastElementChild.remove();
    }
  }

  function resultChecksum(result) {
    const values = collectNumericSeries(result);
    return window.SimMath.hashSignal(values);
  }

  function collectNumericSeries(result) {
    if (result.activation) return result.activation.flat();
    const values = [];
    for (const value of Object.values(result.series || {})) {
      if (Array.isArray(value)) values.push(...value.filter((item) => item !== null));
    }
    return values;
  }

  function reportRuntimeError(error) {
    elements.liveStatus.textContent = "FAULT";
    elements.liveStatus.classList.add("is-warning");
    appendConsoleLine(`Runtime fault: ${error.message}`, "danger");
    console.error(error);
  }

  function togglePlay() {
    if (state.isPlaying) {
      stopPlayback();
      return;
    }
    if (domain().id !== "pulse") {
      showToast("这组仪器暂无自动扫参；拖拽滑块即可观察响应。");
      return;
    }
    state.isPlaying = true;
    state.playStartedAt = performance.now();
    state.playStartGdd = Number.isFinite(state.params.gdd) ? state.params.gdd : 0;
    elements.playButton.classList.add("is-playing");
    elements.playButton.querySelector("[data-play-label]").textContent = "停止扫参";
    if (state.reducedMotion) {
      animatePulseSweep(0);
      return;
    }
    state.playFrame = requestAnimationFrame(animatePulseSweep);
  }

  function animatePulseSweep(timestamp) {
    if (!state.isPlaying) return;
    if (!state.resumeParams) {
      state.resumeParams = { ...state.params };
      state.resumePresetId = state.presetId;
    }
    const elapsed = timestamp - state.playStartedAt;
    const cycle = (elapsed / 7500) % 1;
    const gdd = -600 + cycle * 1200;
    state.params = window.Domains.normalizeParams(domain(), {
      ...state.params,
      gdd,
    });
    state.presetId = "";
    updateControlValues(domain());
    updatePresetSelection();
    computeAndRender({ source: "sweep" });
    if (!state.reducedMotion) state.playFrame = requestAnimationFrame(animatePulseSweep);
  }

  function stopPlayback() {
    const shouldRestore =
      state.isPlaying && state.resumeParams && domain().id === "pulse";
    if (!shouldRestore) {
      state.resumeParams = null;
      state.resumePresetId = "";
    }
    state.isPlaying = false;
    if (state.playFrame) cancelAnimationFrame(state.playFrame);
    state.playFrame = null;
    elements.playButton.classList.remove("is-playing");
    const label = elements.playButton.querySelector("[data-play-label]");
    if (label) label.textContent = "自动扫参";
    if (shouldRestore) {
      state.params = state.resumeParams;
      state.presetId = state.resumePresetId;
      state.resumeParams = null;
      state.resumePresetId = "";
      updateControlValues(domain());
      updatePresetSelection();
      computeAndRender({ source: "sweep-stop" });
    }
  }

  function togglePhasePanel(show) {
    const panel = document.querySelector("[data-phase-panel]");
    if (panel) panel.classList.toggle("is-hidden", !show);
  }

  function openExportDialog() {
    if (!state.result) return;
    elements.exportCode.textContent = "正在打包数值内核与渲染器…";
    elements.exportDialog.showModal();
    buildStandaloneDocument()
      .then((html) => {
        elements.exportCode.textContent = html;
      })
      .catch((error) => {
        elements.exportCode.textContent = `打包失败：${error.message}`;
      });
  }

  function closeExportDialog() {
    if (elements.exportDialog.open) elements.exportDialog.close();
  }

  async function buildStandaloneDocument() {
    const currentDomain = domain();
    const payload = {
      domainId: currentDomain.id,
      params: state.params,
      blueprint: currentDomain.dynamic ? currentDomain.blueprint : undefined,
    };
    return window.buildStandaloneHtml(payload);
  }

  async function downloadExport() {
    const html = await buildStandaloneDocument();
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `physics-${state.domainId}-${Date.now()}.html`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 2000);
    showToast("单文件仪器已导出，可直接离线打开。");
  }

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(elements.exportCode.textContent);
      elements.exportCopy.textContent = "已复制";
      setTimeout(() => (elements.exportCopy.textContent = "复制源码"), 1600);
    } catch (error) {
      showToast("复制失败，请手动选择源码。");
    }
  }

  function openAuditPanel() {
    elements.auditPanel.querySelector(".audit-panel__method").innerHTML = `
      <div class="method-step">
        <span>01</span>
        <p>记录默认、全局极小、全局极大与全部顿悟预设</p>
      </div>
      <div class="method-step">
        <span>02</span>
        <p>逐个拨动每个滑块至两端，比较 Canvas 像素 MSE</p>
      </div>
      <div class="method-step">
        <span>03</span>
        <p>读取所有计算序列，拦截 NaN / Infinity 与死控制</p>
      </div>
    `;
    elements.auditPanel.classList.add("is-open");
    elements.auditPanel.setAttribute("aria-hidden", "false");
    elements.auditButton.setAttribute("aria-expanded", "true");
    runVisualAudit();
  }

  function closeAuditPanel() {
    elements.auditPanel.classList.remove("is-open");
    elements.auditPanel.setAttribute("aria-hidden", "true");
    elements.auditButton.setAttribute("aria-expanded", "false");
  }

  async function runVisualAudit() {
    const currentDomain = domain();
    elements.auditResults.innerHTML = "";
    elements.auditSummary.textContent = "正在枚举边界与采集证据…";
    elements.auditStatus.textContent = "RUNNING";
    elements.auditStatus.className = "audit-status is-running";
    const runId = Date.now();
    state.activeRun = runId;
    const screenshots = {};
    const defaultParams = window.Domains.defaultParams(currentDomain);

    const states = [
      { id: "A", name: "默认值", params: state.params, tone: "default" },
      { id: "B", name: "全局极小", params: fromControls(currentDomain, "min"), tone: "min" },
      { id: "C", name: "全局极大", params: fromControls(currentDomain, "max"), tone: "max" },
      ...currentDomain.presets.map((preset, index) => ({
        id: `P${index + 1}`,
        name: preset.name,
        params: window.Domains.presetParams(currentDomain, preset.id),
        tone: "preset",
      })),
      ...currentDomain.controls.flatMap((control) => [
        {
          id: `${control.id}-MIN`,
          name: `${control.label} = min`,
          params: { ...defaultParams, [control.id]: control.min },
          tone: "axis-min",
        },
        {
          id: `${control.id}-MAX`,
          name: `${control.label} = max`,
          params: { ...defaultParams, [control.id]: control.max },
          tone: "axis-max",
        },
      ]),
    ];

    const rows = [];
    for (const auditState of states) {
      setParams(auditState.params, { presetId: "", source: "audit" });
      await nextPaint();
      const snapshot = captureSnapshot(currentDomain, auditState);
      screenshots[auditState.id] = snapshot;
      rows.push(snapshot);
      renderAuditRows(rows, false);
    }

    const baseline = screenshots.A;
    const diffs = ["B", "C", ...currentDomain.presets.map((_preset, index) => `P${index + 1}`)].map(
      (id) => ({
        id,
        mse:
          baseline && screenshots[id]
            ? comparePixelBuffers(baseline.pixels, screenshots[id].pixels)
            : 0,
      }),
    );
    const finite = rows.every((row) => row.finite);
    const deadControls = currentDomain.controls
      .filter((control) => {
        const atMin = rows.find((row) => row.id === `${control.id}-MIN`);
        const atMax = rows.find((row) => row.id === `${control.id}-MAX`);
        if (!atMin || !atMax) return false;
        const b0 = screenshots.A;
        if (!b0) return false;
        return (
          comparePixelBuffers(b0.pixels, atMin.pixels) < 1e-7 &&
          comparePixelBuffers(b0.pixels, atMax.pixels) < 1e-7
        );
      })
      .map((control) => control.label);
    const maxMse = Math.max(0, ...diffs.map((item) => item.mse));
    const passed = finite && deadControls.length === 0 && maxMse > 0.00002;
    const report = {
      status: passed ? "PASS" : "FAIL",
      visual_diff_detected: maxMse > 0.00002,
      defects: [
        ...(finite
          ? []
          : [
              {
                state: "BOUNDARY",
                category: "NaN_Infinity",
                observed_issue: "极端参数组合产生了非有限数值。",
                fix_instruction_for_coder:
                  "检查控制参数映射，在除法与平方根前增加安全下限。",
              },
            ]),
        ...(maxMse <= 0.00002
          ? [
              {
                state: "State A / B / C",
                category: "Dead_Slider",
                observed_issue: "极端参数状态下画布像素几乎不变，交互可能失效。",
                fix_instruction_for_coder:
                  "确保控制参数进入真实数值路径，并将计算结果映射到 Canvas。",
              },
            ]
          : []),
        ...deadControls.map((label) => ({
          state: "ALL",
          category: "Dead_Control",
          observed_issue: `${label} 在最小与最大状态之间没有可观测的数值差异。`,
          fix_instruction_for_coder:
            "将该控制接入物理内核，或从交互面板移除。",
        })),
      ],
      snapshots: rows.map(({ pixels, ...row }) => ({
        state: row.id,
        label: row.name,
        trace: row.trace,
        finite: row.finite,
        meanLuminance: Number(row.meanLuminance.toFixed(4)),
        metrics: row.metrics,
      })),
      pixelDiff: diffs,
      controlsTested: currentDomain.controls.length,
      cartesianBoundaryCombinations:
        2 ** Math.min(currentDomain.controls.length, 12),
    };

    renderAuditRows(rows, true);
    elements.auditSummary.textContent = passed
      ? `PASS · ${report.controlsTested} 个控制通道通过像素差分与有限性探针。`
      : `FAIL · 检出 ${report.defects.length} 个需要修复的问题。`;
    elements.auditStatus.textContent = report.status;
    elements.auditStatus.className = `audit-status ${passed ? "is-pass" : "is-fail"}`;
    renderAuditReport(report);
    window.__SIM_CONTROLLER__.lastAuditReport = report;
    if (optionsForAuditHook) optionsForAuditHook(report);
    appendConsoleLine(
      `audit ${report.status}  ${report.snapshots.length} states  ·  max MSE ${maxMse.toExponential(2)}`,
      passed ? "accent" : "danger",
    );
  }

  let optionsForAuditHook = null;

  function captureSnapshot(currentDomain, auditState) {
    const canvas = elements.primaryCanvas;
    const image = readCanvasPixels(canvas);
    const metrics = sanitizeMetrics(state.result.metrics);
    const domainSeries = Object.values(state.result.series || {});
    const seriesFinite = domainSeries
      .filter(Array.isArray)
      .every((series) => window.SimMath.finiteStats(series).finite);
    const activationFinite =
      !state.result.activation ||
      window.SimMath.finiteStats(state.result.activation.flat()).finite;
    return {
      id: auditState.id,
      name: auditState.name,
      width: canvas.width,
      height: canvas.height,
      pixels: image,
      trace: resultChecksum(state.result),
      finite: state.result.checks.finite && seriesFinite && activationFinite,
      meanLuminance: averageLuminance(image),
      metrics,
      params: { ...state.params },
    };
  }

  async function captureAuditState(id, params) {
    setParams(params, { presetId: "", source: "audit" });
    await nextPaint();
    return captureSnapshot(domain(), { id, name: id });
  }

  function readCanvasPixels(canvas) {
    const width = 250;
    const height = Math.max(
      1,
      Math.round((width * canvas.height) / Math.max(1, canvas.width)),
    );
    const buffer = document.createElement("canvas");
    buffer.width = width;
    buffer.height = height;
    const context = buffer.getContext("2d", { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  }

  function comparePixelBuffers(a, b) {
    if (!a || !b) return 0;
    let sum = 0;
    let count = 0;
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index += 16) {
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = (a[index + channel] - b[index + channel]) / 255;
        sum += delta * delta;
        count += 1;
      }
    }
    return count ? sum / count : 0;
  }

  function averageLuminance(data) {
    let sum = 0;
    let count = 0;
    for (let index = 0; index < data.length; index += 16) {
      sum +=
        (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) /
        255;
      count += 1;
    }
    return count ? sum / count : 0;
  }

  function sanitizeMetrics(metrics) {
    const output = {};
    for (const [key, value] of Object.entries(metrics)) {
      if (Number.isFinite(value)) output[key] = Number(value.toFixed(5));
    }
    return output;
  }

  function renderAuditRows(rows, complete) {
    elements.auditResults.innerHTML = rows
      .map(
        (row) => `
          <div class="audit-row ${row.finite ? "is-pass" : "is-fail"}">
            <span class="audit-row__id">${row.id}</span>
            <span class="audit-row__body">
              <span class="audit-row__name">${row.name}</span>
              <span class="audit-row__meta">trace ${row.trace} · L ${row.meanLuminance.toFixed(3)}</span>
            </span>
            <span class="audit-row__state">${row.finite ? "FINITE" : "NON-FINITE"}</span>
          </div>
        `,
      )
      .join("");
    if (!complete) {
      elements.auditSummary.textContent = `采集中 · ${rows.length} 个状态已记录`;
    }
  }

  function renderAuditReport(report) {
    const reportEl = document.createElement("pre");
    reportEl.className = "audit-report";
    reportEl.textContent = JSON.stringify(
      {
        status: report.status,
        visual_diff_detected: report.visual_diff_detected,
        controls_tested: report.controlsTested,
        boundary_combinations: report.cartesianBoundaryCombinations,
        pixel_diff: report.pixelDiff.map((item) => ({
          state: item.id,
          mse: Number(item.mse.toExponential(3)),
        })),
        defects: report.defects,
      },
      null,
      2,
    );
    elements.auditResults.appendChild(reportEl);
  }

  function fromControls(currentDomain, mode) {
    return Object.fromEntries(
      currentDomain.controls.map((control) => [
        control.id,
        mode === "min" ? control.min : control.max,
      ]),
    );
  }

  function nextPaint() {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 2800);
  }

  function hexToRgba(hex, alpha) {
    const normalized = hex.replace("#", "");
    const value = parseInt(normalized, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function exposeController() {
    const controller = {
      setParams: async (params) => {
        setParams(params, { presetId: "", source: "remote" });
        await nextPaint();
        return controller.getStateMetrics();
      },
      setPreset: async (presetId) => {
        applyPreset(presetId);
        await nextPaint();
        return controller.getStateMetrics();
      },
      setDomain: async (domainId) => {
        selectDomain(domainId);
        await nextPaint();
        return controller.getStateMetrics();
      },
      getStateMetrics: () => {
        if (!state.result) return null;
        const values = collectNumericSeries(state.result);
        const stats = window.SimMath.finiteStats(values);
        return {
          domain: state.domainId,
          params: { ...state.params },
          presetId: state.presetId || null,
          metrics: sanitizeMetrics(state.result.metrics),
          seriesFinite: stats.finite,
          hasNaN: stats.hasNaN,
          hasInfinity: stats.hasInfinity,
          minValue: stats.min,
          maxValue: stats.max,
          trace: resultChecksum(state.result),
          checksum: resultChecksum(state.result),
          checks: state.result.checks,
          canvas: {
            width: elements.primaryCanvas.width,
            height: elements.primaryCanvas.height,
            hash: window.PhenomenaChart.canvasHash(
              elements.primaryCanvas,
              10,
            ).hash,
          },
        };
      },
      getDomain: () => state.domainId,
      getControls: () =>
        domain().controls.map((control) => ({
          ...control,
          value: state.params[control.id],
        })),
      registerBlueprint: (blueprint) =>
        registerGeneratedBlueprint(blueprint, {
          model: "test-fixture",
          exampleId: "fixture",
        }),
      snapshotSecondaryPixels: () => readCanvasPixels(elements.secondaryCanvas),
      getCanvasProbe: () => ({
        grid: elements.primaryCanvas.__gridProbe
          ? {
              probe: elements.primaryCanvas.__gridProbe.probe,
              hover: elements.primaryCanvas.__gridProbe.hover,
            }
          : null,
        mode: elements.plotMode.textContent,
      }),
      runVisualAudit: async () => {
        if (!elements.auditPanel.classList.contains("is-open")) openAuditPanel();
        const waitForResult = () =>
          new Promise((resolve) => {
            const existing = window.__SIM_CONTROLLER__.lastAuditReport;
            if (existing && existing._hooked !== true) {
              existing._hooked = true;
              resolve(existing);
            }
          });
        return new Promise((resolve) => {
          optionsForAuditHook = (report) => {
            optionsForAuditHook = null;
            resolve(report);
          };
        });
      },
      captureState: async (params) => captureAuditState("capture", params),
      buildStandaloneHtml: (params) =>
        window.buildStandaloneHtml({
          domainId: state.domainId,
          params: params || state.params,
          blueprint: domain().dynamic ? domain().blueprint : undefined,
        }),
      snapshotPixels: () => readCanvasPixels(elements.primaryCanvas),
      comparePixels: (a, b) => comparePixelBuffers(a, b),
      openAuditPanel,
      closeAuditPanel,
    };
    window.__SIM_CONTROLLER__ = controller;
  }
})();
