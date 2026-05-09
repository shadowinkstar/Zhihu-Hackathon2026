import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const logsDir = path.join(process.cwd(), "data", "call-logs");

if (!existsSync(logsDir)) {
  console.log("No call logs yet.");
  process.exit(0);
}

const files = readdirSync(logsDir)
  .filter((file) => file.endsWith(".jsonl"))
  .sort();

if (files.length === 0) {
  console.log("No call logs yet.");
  process.exit(0);
}

const latest = files.at(-1);
const lines = readFileSync(path.join(logsDir, latest), "utf8")
  .split(/\r?\n/)
  .filter(Boolean);

console.log(`Latest log file: data/call-logs/${latest}`);
console.log(`Events: ${lines.length}`);
console.log("");

for (const line of lines.slice(-20)) {
  const event = JSON.parse(line);
  const summary = [
    event.loggedAt,
    event.event,
    event.ok ? "ok" : "fail",
    event.promptVersion || "-",
    event.provider || "-",
    event.model || "-",
    event.durationMs != null ? `${event.durationMs}ms` : "-",
  ];
  console.log(summary.join(" | "));

  if (event.request?.sourceTitle) {
    console.log(`  title: ${event.request.sourceTitle}`);
  }

  if (event.response?.outputSummary?.preview) {
    console.log(`  output: ${event.response.outputSummary.preview.replace(/\s+/g, " ").slice(0, 160)}`);
  } else if (event.response?.continuation) {
    console.log(`  output: ${event.response.continuation.replace(/\s+/g, " ").slice(0, 160)}`);
  }

  if (event.response?.usage) {
    console.log(`  usage: ${JSON.stringify(event.response.usage)}`);
  }

  const finish = [event.response?.stopReason, event.response?.finishReason].filter(Boolean).join(" / ");
  if (finish) {
    console.log(`  finish: ${finish}`);
  }

  if (event.response?.contentTypes?.length) {
    console.log(`  content: ${event.response.contentTypes.join(", ")}`);
  }

  if (event.error?.message) {
    console.log(`  error: ${event.error.message}`);
  }
}
