#!/usr/bin/env node

/**
 * Bumps the patch number of expo.version in app.json (1.0.8 -> 1.0.9).
 * EAS tracks the iOS build number remotely (appVersionSource: "remote"),
 * but never touches the user-facing version, so `npm run build:ios` runs
 * this first. Edits the line in place to keep app.json's formatting.
 */

const fs = require("fs");
const path = require("path");

// npm runs scripts from the project root.
const file = path.join(process.cwd(), "app.json");
const src = fs.readFileSync(file, "utf8");
const current = JSON.parse(src).expo.version;

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!match) {
  console.error(`app.json expo.version "${current}" is not x.y.z`);
  process.exit(1);
}

const next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
const out = src.replace(`"version": "${current}"`, `"version": "${next}"`);
if (JSON.parse(out).expo.version !== next) {
  console.error("Could not update expo.version in app.json");
  process.exit(1);
}

fs.writeFileSync(file, out);
console.log(`app.json version ${current} -> ${next} (commit app.json after the build)`);
