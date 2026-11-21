// Lint rules. The server imports only Node's built-in modules (`node:…`) and its own files: no
// package may reach the running container (plan § 2, „nur Bordmittel“).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: globals.node },
    rules: {
      'no-console': 'error',
      eqeqeq: 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!node:|\\./|\\.\\./)',
              message: 'Der Server nutzt nur Bordmittel von Node (node:…) und eigene Dateien.',
            },
          ],
        },
      ],
    },
  },
  {
    // The log line writer and the command-line scripts may print.
    files: ['src/protokoll.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
