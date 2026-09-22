import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = join(root, "src");

/** Directories of simulation code. Dev guide Sections 4.1 and 5. */
const SIM_DIRS = [
  "core",
  "arena",
  "weapons",
  "sim",
  "ai",
  "progression",
  "meta",
  "names",
  "report",
];

function listTsFiles(dir: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(listTsFiles(full));
    else if (entry.endsWith(".ts")) files.push(full);
  }
  return files;
}

function simFiles(): { path: string; text: string }[] {
  return listTsFiles(srcDir)
    .filter((file) => SIM_DIRS.includes(relative(srcDir, file).split(sep)[0] ?? ""))
    .map((file) => ({ path: relative(root, file), text: readFileSync(file, "utf8") }));
}

describe("module boundaries", () => {
  // Dev guide Section 10.8. ESLint checks the same rules. This test keeps the
  // check inside `npm test`.
  it("finds simulation files to check", () => {
    expect(simFiles().length).toBeGreaterThan(0);
  });

  it("keeps render/, ui/, and main.ts out of the simulation", () => {
    for (const file of simFiles()) {
      for (const match of file.text.matchAll(/from\s+["']([^"']+)["']/g)) {
        const target = match[1] ?? "";
        expect(
          /(^|\/)(render|ui)\//.test(target) || /(^|\/)main(\.js|\.ts)?$/.test(target),
          `${file.path} imports display code: ${target}`,
        ).toBe(false);
      }
    }
  });

  it("keeps browser APIs out of the simulation", () => {
    const banned = /\b(document|window|localStorage|sessionStorage|navigator|HTMLElement)\b/;
    for (const file of simFiles()) {
      // Comments can name a browser API. Check the code only.
      const code = file.text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(banned.test(code), `${file.path} uses a browser API`).toBe(false);
    }
  });

  it("keeps Math.random() and the global ROT.RNG out of all source files", () => {
    // Dev guide Section 3.
    for (const file of listTsFiles(srcDir)) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      const path = relative(root, file);
      expect(/Math\.random\s*\(/.test(code), `${path} uses Math.random()`).toBe(false);
      expect(/\bROT\.RNG\b/.test(code), `${path} uses the global ROT.RNG`).toBe(false);
    }
  });
});
