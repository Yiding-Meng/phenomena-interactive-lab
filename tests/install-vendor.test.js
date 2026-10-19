const test = require("node:test");
const assert = require("node:assert/strict");
const { stat } = require("node:fs/promises");
const { resolve } = require("node:path");

test("browser smoke scripts resolve Playwright from package dependencies", async () => {
  const root = resolve(__dirname, "..");
  const requirement = require("node:module").createRequire(
    resolve(root, "scripts", "run-audit.mjs"),
  );
  const packageFile = requirement.resolve("playwright-core/package.json");
  const info = await stat(packageFile);
  assert.equal(info.isFile(), true);
  assert.match(packageFile, /node_modules[\\/]playwright-core/);
});
