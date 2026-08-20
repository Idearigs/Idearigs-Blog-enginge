// Runs every *.test.mjs in this directory, each in its own process so a test
// that binds a port or stubs a module cannot affect the others.
import { readdirSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter(f => f.endsWith(".test.mjs")).sort();

let failed = 0;
for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const r = spawnSync(process.execPath, [path.join(here, file)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}

console.log(`\n${files.length - failed}/${files.length} suites passed`);
process.exit(failed ? 1 : 0);
