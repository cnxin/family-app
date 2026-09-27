// API 侧 ESLint（flat config）。
// 规则刻意保守：先让现有 5 万行代码零错误通过，再逐步收紧。
// `max-lines` 只告警，用来在 PR 里暴露巨石文件；重构期间新文件应满足 400 行以内。
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      // 以下规则先降为 warn，等 Phase 1 清理完存量后再提升为 error
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-namespace': 'off',
      'no-useless-escape': 'warn',
      'no-case-declarations': 'warn',
      'no-control-regex': 'warn',
      'no-prototype-builtins': 'warn',
      'prefer-const': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'max-lines': [
        'warn',
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // 迁移文件由 TypeORM 生成，不做行数与命名约束
    files: ['src/database/migrations/**/*.ts'],
    rules: {
      'max-lines': 'off',
    },
  },
);
