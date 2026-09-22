// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Directories that hold simulation code. They must stay free of the browser. */
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

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      // Dev guide Section 3: all randomness comes from the seeded RNG streams.
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Use an RNG stream from core/rng.ts. Section 3 of the dev guide.",
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Dev guide Section 4.1 and Section 5: only render/, ui/, and main.ts can
    // use browser APIs or import display code.
    files: SIM_DIRS.map((dir) => `src/${dir}/**/*.ts`),
    languageOptions: {
      globals: { document: "off", window: "off", localStorage: "off", navigator: "off" },
    },
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "document", message: "Simulation code must not use the DOM." },
        { name: "window", message: "Simulation code must not use the DOM." },
        { name: "localStorage", message: "Simulation code must not use browser storage." },
        { name: "navigator", message: "Simulation code must not use browser APIs." },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/render/*", "**/ui/*", "**/main", "**/main.js", "**/main.ts"],
              message: "Simulation code must not import render/, ui/, or main.ts.",
            },
            {
              group: ["rot-js/lib/display*"],
              message: "The rot.js display is browser code. Use it in render/ only.",
            },
          ],
        },
      ],
    },
  },
);
