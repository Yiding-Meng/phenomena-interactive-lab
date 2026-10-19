const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { resolve } = require("node:path");
const { createServer } = require("node:http");

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("server did not start");
}

test("API exposes safe dynamic status and no-key error", async (t) => {
  const port = 4192;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DEEPSEEK_API_KEY: "",
      PHENOMENA_DYNAMIC: "on",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    child.kill("SIGTERM");
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const statusResponse = await waitForServer(baseUrl);
  const status = await statusResponse.json();
  assert.equal(status.configured, false);
  assert.equal(status.examples.length, 4);

  const generated = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ concept: "任意未知概念" }),
  });
  assert.equal(generated.status, 503);
  const payload = await generated.json();
  assert.equal(payload.code, "PROVIDER_NOT_CONFIGURED");
});

test("API compiles an OpenAI-compatible Planner response end to end", async (t) => {
  const blueprint = {
    status: "supported",
    id: "api_rc",
    concept_title: "RC 时间常数",
    short_name: "RC / API",
    subtitle: "指数衰减",
    question: "时间常数如何改变电压衰减？",
    pedagogical_goal: "观察时间常数如何决定指数衰减速度。",
    mathematical_model: {
      governing_equations_latex: ["V(t)=V_0e^{-t/\\tau}"],
      numerical_algorithm: "逐点计算指数衰减，并检查边界有限性。",
      pipeline: [
        {
          id: "voltage",
          kind: "series",
          label: "电压",
          unit: "V",
          expression: "exp(-t / tau)",
          sampleCount: 80,
          xMin: 0,
          xMax: 10,
        },
      ],
    },
    interactive_controls: [
      {
        id: "tau",
        label: "时间常数",
        symbol: "tau",
        unit: "s",
        min: 0.1,
        max: 5,
        step: 0.1,
        default: 1,
        physical_effect: "增大时间常数会减慢衰减。",
      },
    ],
    aha_presets: [
      {
        id: "fast",
        name: "快速衰减",
        description: "较小时间常数。",
        param_values: { tau: 0.3 },
      },
      {
        id: "slow",
        name: "慢速衰减",
        description: "较大时间常数。",
        param_values: { tau: 4.2 },
      },
    ],
    visual_views: [{ type: "2D_Plot", x_axis: "时间", y_axis: "电压" }],
  };
  let plannerRequests = 0;
  const planner = createServer(async (request, response) => {
    plannerRequests += 1;
    for await (const _chunk of request) {
      // Drain the request body before responding.
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        model: "mock-planner",
        choices: [
          {
            message: {
              content: JSON.stringify(blueprint),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    );
  });
  await new Promise((resolvePromise) =>
    planner.listen(0, "127.0.0.1", resolvePromise),
  );
  t.after(() => planner.close());
  const plannerPort = planner.address().port;

  const port = 4193;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${plannerPort}`,
      PHENOMENA_DYNAMIC: "on",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl);
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ concept: "RC 电路时间常数" }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "ok");
  assert.equal(payload.domain.id, "api_rc");
  assert.equal(payload.exampleId, "pulse");
  assert.equal(plannerRequests, 1);
});
