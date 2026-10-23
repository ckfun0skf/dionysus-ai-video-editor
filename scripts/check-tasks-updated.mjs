#!/usr/bin/env node
// Fails when a change touches src/ without updating public/doc/tasks.json.
// Usage: node scripts/check-tasks-updated.mjs <base-ref>   (default: origin/main)
// Bypass for chores: include "[no-task]" in the PR title (env PR_TITLE).
import { execFileSync } from "node:child_process";

const base = process.argv[2] || "origin/main";
if ((process.env.PR_TITLE || "").includes("[no-task]")) {
  console.log("check-tasks-updated: bypassed via [no-task]");
  process.exit(0);
}
const files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
const touchesSrc = files.some((f) => f.startsWith("src/"));
const touchesTasks = files.includes("public/doc/tasks.json");
if (touchesSrc && !touchesTasks) {
  console.error("check-tasks-updated: src/ changed but public/doc/tasks.json was not updated (see docs/v2/MODULE_DESIGN.md §14).");
  process.exit(1);
}
console.log(`check-tasks-updated: ok (${files.length} files, src=${touchesSrc}, tasks=${touchesTasks})`);
