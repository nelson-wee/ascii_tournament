/// <reference types="vitest" />
import { defineConfig } from "vite";

// GitHub Pages serves the project from https://<user>.github.io/<repo>/.
// BASE_PATH is set by the deploy workflow. Local builds use "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
