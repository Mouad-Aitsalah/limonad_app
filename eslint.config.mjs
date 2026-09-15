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
    // PHASE 5A.4 - the whole android/ tree is generated/native tooling
    // (Gradle, Java/Kotlin, XML) plus whatever webDir gets copied into
    // android/app/src/main/assets/public/** and android/app/build/** by
    // `npx cap sync`/a Gradle build - in LOCAL mode (see capacitor.config.ts)
    // that is the Vite shell's own minified bundle, never hand-written
    // source to lint here either way.
    "android/**",
  ]),
]);

export default eslintConfig;
