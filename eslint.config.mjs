// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config shared across the monorepo. Kept deliberately light for
 * the scaffold — TypeScript's own strict mode does the heavy lifting.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.expo/**',
      '**/dist/**',
      '**/build/**',
      '**/web-build/**',
      '**/*.css',
      '**/babel.config.js',
      '**/metro.config.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
