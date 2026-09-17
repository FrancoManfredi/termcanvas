import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function inspectElectron() {
  let packageDir;
  try {
    packageDir = path.dirname(require.resolve("electron/package.json"));
  } catch {
    return { status: "package-missing" };
  }

  const pathFile = path.join(packageDir, "path.txt");
  if (!fs.existsSync(pathFile)) return { status: "binary-missing" };

  const binary = path.join(packageDir, "dist", fs.readFileSync(pathFile, "utf8").trim());
  return fs.existsSync(binary) ? { status: "ok" } : { status: "binary-missing" };
}

const state = inspectElectron();

if (state.status === "package-missing") {
  console.error("[ensure-electron] The electron package is not installed.");
  console.error("[ensure-electron] Run:");
  console.error("");
  console.error("    pnpm install");
  console.error("");
  console.error("[ensure-electron] Then run pnpm dev again.");
  process.exit(1);
}

if (state.status === "binary-missing") {
  console.error("[ensure-electron] Electron runtime is missing: the electron package is present but its binary was never downloaded.");
  console.error("[ensure-electron] This usually means dependencies were installed with lifecycle scripts skipped.");
  console.error("[ensure-electron] Fix it with:");
  console.error("");
  console.error("    pnpm rebuild electron");
  console.error("");
  console.error("[ensure-electron] Then run pnpm dev again.");
  process.exit(1);
}
