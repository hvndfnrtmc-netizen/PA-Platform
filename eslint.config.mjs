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
  ]),
  {
    rules: {
      // ── console: allow error/warn, warn on log/debug ─────────────
      "no-console": [
        "warn",
        { allow: ["error", "warn"] },
      ],
      // ── TypeScript: discourage any, catch unused vars ────────────
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // ── Code quality basics ──────────────────────────────────────
      "no-debugger": "error",
      "no-var": "error",
      "prefer-const": "warn",
      "no-duplicate-imports": "warn",
      "no-unreachable": "error",
    },
  },
]);

export default eslintConfig;
