import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = dirname(require.resolve("playwright-core/package.json"));

if (!existsSync(source)) {
  console.log("playwright-core is not installed; runtime check skipped.");
  process.exit(0);
}

console.log(`playwright-core ready -> ${source}`);
