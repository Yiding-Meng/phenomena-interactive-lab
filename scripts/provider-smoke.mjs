import compiler from "../src/blueprint-compiler.js";
import golden from "../examples/golden/index.js";
import schema from "../src/blueprint-schema.js";

const { BlueprintError } = compiler;
const { getGoldenExample, selectGoldenExample } = golden;
const { plannerSystemPrompt } = schema;

console.log({
  example: selectGoldenExample("周期、摆角与非线性").concept_title,
  pulse: getGoldenExample("pulse").concept_title,
  promptBytes: Buffer.byteLength(plannerSystemPrompt(), "utf8"),
  errorType: new BlueprintError("example", "field").name,
});
