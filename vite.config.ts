/// <reference types="vitest" />
import { execSync } from "node:child_process";
import { defineConfig } from "vite";

/**
 * The commit that a build was made from (dev-guide Section 7.23).
 *
 * A replay ticket carries it, because a seed replays a match only against the
 * same engine. A tree with no git, or a tree with changes in it, is not a
 * version, and this says so rather than naming a commit that does not match
 * what is on disk.
 */
function buildCommit(): string {
  try {
    const commit = execSync("git rev-parse --short=8 HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "";
    return dirty ? `${commit}+` : commit;
  } catch {
    return "dev";
  }
}

// GitHub Pages serves the project from https://<user>.github.io/<repo>/.
// BASE_PATH is set by the deploy workflow. Local builds use "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
