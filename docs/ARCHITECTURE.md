# Phenomena 架构

Phenomena 是一个本地优先的“概念到交互仪器”工作台。它把生成过程分为
“可理解的结构”和“可执行的数值”两层：未知概念先成为白名单 JSON 蓝图，
再被编译成确定性的计算图。模型不能直接向页面注入任意 JavaScript。

## 双路径

```text
用户概念
   │
   ├── 本地语义路由命中 ───────────────┐
   │                                  ▼
   │                         四个内置真实数值内核
   │                         （FFT / RK4 / CNN / 单摆）
   │                                  │
   └── 未命中 → Planner API ──┐        │
                              ▼        │
                     JSON 蓝图校验     │
                              │        │
                              ▼        │
                     白名单表达式编译器 │
                              │        │
                              ▼        │
                动态 Domain + 自动图表  │
                              └────┬───┘
                                   ▼
                    Runtime Probe + Pixel-Diff Gate
                                   │
                         ┌─────────┴─────────┐
                         ▼                   ▼
                       PASS                FAIL
                   交互 / 离线导出      结构化缺陷报告
```

内置内核与动态图共享同一套控制器、画布指标、Aha 预设、
参数扫频和离线导出管线，因此不会形成两套互不一致的产品行为。

## 运行单元

| 单元 | 职责 | 关键文件 |
| --- | --- | --- |
| `ConceptRouter` | 将已知概念映射到真实内核；未知概念交给 Planner | `src/routing.js` |
| `Planner Schema` | System Prompt、JSON 提取、结构预校验 | `src/blueprint-schema.js` |
| `Golden Examples` | 四类 Few-Shot 结构样本与最近邻选择 | `examples/golden/` |
| `LLM Provider` | OpenAI-compatible Chat Completions、超时与错误归一化 | `src/llm-provider.js` |
| `Generation Service` | 选取 Golden、调用 Planner、编译、默认/边界探针 | `src/generation-service.js` |
| `Blueprint Compiler` | 白名单表达式图、参数钳制、Domain 适配 | `src/blueprint-compiler.js` |
| `Domains` | 四个内置模型和动态模型注册表 | `src/domains.js` |
| `SimMath` | FFT/IFFT、RK4、矩阵运算、FWHM、有限性统计 | `src/simmath.js` |
| `PhenomenaChart` | Canvas、网格卷积探针、相空间、像素读取 | `src/chart-renderer.js` |
| `app` | 控件、预设、联动视图、controller、浏览器审计 | `src/app.js` |
| `StandaloneBuilder` | 把当前模型和参数打包成自包含 HTML | `src/standalone-builder.js` |
| `Release Check` | 排除开发依赖和 macOS 垃圾文件后生成 ZIP | `scripts/package-check.mjs` |

## 动态蓝图协议

Planner 产出的核心结构如下：

```json
{
  "status": "supported",
  "concept_title": "概念名称",
  "pedagogical_goal": "用户应该建立的直觉",
  "mathematical_model": {
    "governing_equations_latex": ["..."],
    "numerical_algorithm": "...",
    "pipeline": [
      {
        "id": "series_id",
        "kind": "series",
        "label": "响应",
        "unit": "a.u.",
        "expression": "exp(-gamma * t) * sin(omega * t)",
        "sampleCount": 240,
        "xMin": 0,
        "xMax": 10
      }
    ]
  },
  "interactive_controls": [],
  "aha_presets": [],
  "visual_views": []
}
```

`pipeline` 是执行契约，而不是装饰性说明。每个输出必须是：

- `series`：按 `xMin..xMax` 采样的一维序列；
- `scalar`：与采样无关的单值结果；
- `indicator`：对序列做标量汇总。

编译器随后执行：

1. 长度、类型和标识符校验；
2. 表达式符号与函数白名单检查；
3. 控制量 `min/max/step/default` 校验；
4. Aha 预设和运行时参数钳制；
5. 默认参数、全局双边界有限性探针；
6. 编译为统一 Domain，交给现有交互与画布层。

### 安全边界

当前动态编译器不支持任意循环、赋值、对象、数组、字符串、反射和网络调用。
它只支持一维确定性表达式图，以及 `2D_Plot`、`Dual_Plot`、
`Parameter_Sweep` 三类视图。需要 FFT、RK4、二维卷积、向量场或三维画面时，
必须走内置专用内核，或者先扩展编译器和渲染原语。

这不是能力缺陷的遮掩，而是防止“模型生成代码看起来能跑，实际物理和视觉都失真”
的工程边界。Planner 对无法严谨表达的概念必须返回 `unsupported`。

## 四个真实内核

### 超短脉冲色散

- 时域高斯包络 → FFT；
- 频域叠加 `exp(i(½φ₂ω² + ⅙φ₃ω³))`；
- IFFT 回时域，计算 `|E(t)|²`；
- FWHM、展宽倍率、峰值与频谱均来自真实数组。

相位曲线只在幅度高于显示门限的频段绘制，避免把浮点噪声伪装成物理相位。

### 阻尼谐振子

- 状态向量 `[x, v]`；
- RK4 积分受迫、阻尼二阶方程；
- 同时绘制时域响应与解析幅频响应，并保留当前工作点。

### 卷积感受野

- 合成 48×48 输入；
- 按核尺寸和 σ 构造归一化高斯核；
- 带边界补零的二维卷积与 ReLU；
- 输入 / 核 / 激活三联热图；
- 鼠标悬停可查看真实局部 patch、逐点积和输出链路。

### 非线性单摆

- RK4 积分真实 `sin θ`；
- 小角度解析解作为固定 Ghost Baseline；
- 通过上穿零点估计真实周期；
- 联动视图展示 `(θ, dθ/dt)` 相空间、方向和起终点。

## 视觉原语

`chart-renderer.js` 目前提供：

| 原语 | 用途 |
| --- | --- |
| `renderPlot` | 单画布双序列、基线、区间标注、响应式高清绘制 |
| `renderGridWithProbe` | 二维张量热力图、局部卷积探针、边缘与 stride 处理 |
| `renderPhaseSpaceTrajectory` | 相空间轨迹、方向箭头、起终点、极端参数边界 |
| 参数扫频 | 动态模型根据当前控制量重算全区间指标，并绘制工作点 |

所有副图都把指标和图例放在 Canvas 外部；Canvas 只负责真实绘图。

## 三类故障如何被拦截

### 假仿真

`window.__SIM_CONTROLLER__.getStateMetrics()` 返回参数、指标、有限性、
序列范围、trace 和画布 hash。测试直接断言物理趋势：

- GDD 增大必须展宽；
- 阻尼增大必须压低共振峰；
- stride 增大必须降低 CNN 输出分辨率；
- 大摆角周期必须偏离线性周期。

### 废滑块

浏览器质检会：

1. 记录默认、全局极小、全局极大和全部预设；
2. 逐个把每个控制量单独拨到最小、最大；
3. 比较默认画面与各端点的 Canvas MSE；
4. 如果某个控制量两端都与默认画面无差异，报告 `Dead_Control`。

动态 fixture 还同时比较主画布和参数扫频副图，防止“主图变了，副图却始终静止”。

### 睁眼瞎

质检同时采集：

- 浏览器 console error；
- page error；
- Canvas 像素均方误差；
- 计算序列中的 NaN / Infinity；
- 每张快照的 trace、指标和平均亮度；
- 离线导出页的 controller 状态与交互。

终端不报错不再等于完成。

## 质量门

```bash
npm test
npm run export:demo
npm run test:browser
npm run package:clean
```

`test:browser` 会启动只监听 `127.0.0.1` 的临时服务，并默认寻找缓存的
Chromium Headless Shell。可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 覆盖路径。

测试证据写入 `artifacts/audit/report.json`，截图位于 `artifacts/audit/`，
离线 HTML 位于 `artifacts/exports/`，发布包位于 `artifacts/release/`。

## 当前未实现

- 外部 LLM 的端到端调用依赖真实 API Key；仓库测试使用确定性 fixture、
  fake provider 和本地 OpenAI-compatible mock。
- 自动化 VLM 修复回路尚未接入；当前已有结构化缺陷报告、Pixel-Diff 和有限性探针。
- 动态表达式图仍是一维的，复杂二维/三维仿真使用内置专用内核。
- JavaScript 未启用 TypeScript 式静态类型；运行时 Schema 与测试承担主要契约验证。
