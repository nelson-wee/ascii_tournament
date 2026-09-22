/**
 * Browser entry point.
 *
 * Milestone M0 shows a placeholder page. It proves that the build, the data
 * loader, and the RNG streams work in the browser. The arena display arrives
 * with Milestone M1.
 */
import { loadTuning } from "./core/data.js";
import { createRngStreams, RNG_STREAM_NAMES } from "./core/rng.js";
import { EventBus } from "./core/events.js";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("The element #app is missing from index.html");

const tuning = loadTuning();
const streams = createRngStreams(1);
const bus = new EventBus();
bus.emit("MatchStart", 0, 0, { note: "placeholder" });

const sample = RNG_STREAM_NAMES.map(
  (name) => `${name.padEnd(12)} ${streams[name].next().toFixed(6)}`,
).join("\n");

const title = document.createElement("h1");
title.textContent = "ASCII BOT SHOOTER";

const status = document.createElement("p");
status.textContent = "Milestone M0 — scaffolding and deployment.";

const note = document.createElement("p");
note.className = "dim";
note.textContent = "The arena display arrives with Milestone M1.";

const report = document.createElement("pre");
report.textContent = [
  `tick rate            ${tuning.simulation.ticksPerSecond} ticks/second`,
  `AI decision interval ${tuning.simulation.aiDecisionIntervalTicks} ticks`,
  `team size            ${tuning.match.teamSize} bots`,
  `match format         best of ${tuning.match.maxRounds}`,
  `events logged        ${bus.log.length}`,
  "",
  "RNG streams (seed 1, first value):",
  sample,
].join("\n");

app.append(title, status, note, report);
