// ESLint flat config - next/core-web-vitals + TS. The eslint-disable comment
// on the board's portrait <img> needs @next/next/no-img-element from this.
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts']),
]);

export default eslintConfig;
