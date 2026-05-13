import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const distDir = ".next-build";
const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const distPath = path.join(process.cwd(), distDir);

console.log(`Using Next distDir: ${distDir}`);
rmSync(distPath, { recursive: true, force: true });

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
