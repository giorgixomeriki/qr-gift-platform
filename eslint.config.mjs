import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Supabase CLI's local runtime cache — vendored/generated, not our source.
      "supabase/.temp/**",
      "supabase/.branches/**",
    ],
  },
  {
    // Standalone dev-only verification scripts (run via tsx, not Next's
    // bundler) — require() is needed here to control module-load order for
    // the server-only shim, see verify-commercial-invariants.ts's comment.
    files: ["scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
