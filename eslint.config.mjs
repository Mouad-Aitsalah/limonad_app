import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // PHASE 5A.1 - the Vite driver shell (mobile/driver/) is its own
    // separate npm project with its own build output - never source to lint
    // here (it is already type-checked and linted by its own tooling as
    // part of `npm run build:driver-mobile`).
    "mobile/driver/dist/**",
  ]),
]);

export default eslintConfig;
