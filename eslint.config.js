import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", ".claude", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": "off",
      // The project intentionally colocates constants/variants with several
      // reusable shadcn-style components. These warnings do not indicate a
      // production defect and would require broad file moves for no runtime
      // benefit.
      "react-refresh/only-export-components": "off",
    },
  },
  eslintPluginPrettier,
  // The repository contains older JavaScript modules with a different
  // formatting baseline. Formatting remains available through `npm run format`,
  // while lint should report correctness issues rather than thousands of
  // unrelated quote/line-break differences.
  { rules: { "prettier/prettier": "off" } },
);
