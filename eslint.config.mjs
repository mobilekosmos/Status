// ESLint flat config. ESLint 10 no longer reads the old .eslintrc format.
// Docs: https://eslint.org/docs/latest/use/configure/configuration-files
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';

export default defineConfig([
  // Forge build output and the local Forge skills checkout are not our code.
  globalIgnores(['.forge/', '.forge-skills/']),

  // ESLint's recommended rules catch real bugs such as unused variables.
  js.configs.recommended,

  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      // The resolver runs on Node.js (it uses Buffer); the UI Kit frontend
      // runs in the browser. Allow the globals of both environments.
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // Rules of Hooks, exhaustive effect dependencies and the React Compiler
  // checks that ship with eslint-plugin-react-hooks 7.
  reactHooks.configs.flat.recommended,
]);
