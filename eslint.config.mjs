// ESLint flat config - next/core-web-vitals + TS, translated via FlatCompat
// (eslint-config-next 15.x ships eslintrc-style shareable configs, not flat
// arrays). The eslint-disable comment on the board's portrait <img> needs
// @next/next/no-img-element from this.
import { defineConfig, globalIgnores } from 'eslint/config';
import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = defineConfig([
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  globalIgnores(['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts']),
]);

export default eslintConfig;
