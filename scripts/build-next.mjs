import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const stamp = new Date()
  .toISOString()
  .replaceAll(":", "")
  .replaceAll(".", "")
  .replace("T", "-")
  .replace("Z", "");
const distDir = `.next-build-${stamp}`;
const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

console.log(`Using Next distDir: ${distDir}`);

const child = spawn(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    NEXT_DIST_DIR: distDir,
  },
});

function cleanupTsconfig() {
  const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
  const raw = readFileSync(tsconfigPath, "utf8");
  const config = JSON.parse(raw);

  if (Array.isArray(config.include)) {
    config.include = config.include.filter(
      (entry) => typeof entry !== "string" || !entry.startsWith(".next-build-"),
    );
  }

  writeFileSync(tsconfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

child.on("exit", (code, signal) => {
  if (code === 0) {
    cleanupTsconfig();
  }

  if (signal) {
    console.error(`next build exited with signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
