// eslint.config.js — flat config (ESLint 9) สำหรับ designer/ (TypeScript + Lit) · #17
// เป้าหมาย: จับ bug จริง (unused, unsafe, fallthrough) เป็น error; noise เชิงสไตล์เป็น warn
// รัน: npm run lint · CI เรียกผ่าน npm run lint --if-present ใน quality-gate
// @author Wichit Wongta @since 2026-07-17
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'storybook-static/**',
      'node_modules/**',
      'coverage/**',
      '**/*.config.{js,ts}',
      '.storybook/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      // tsc คุม unused ผ่าน noUnusedLocals/Params อยู่แล้ว — ให้ eslint เตือนซ้ำแบบ warn
      // และอนุญาต prefix _ สำหรับ intentional-unused
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Lit/DOM code ใช้ any ในหลายจุดที่ typing เต็มไม่คุ้ม — เตือนไว้ ไม่ block
      '@typescript-eslint/no-explicit-any': 'warn',
      // ปล่อยให้เขียน empty catch / interface ได้ (มีใน DS pattern) — warn
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    // test/story ผ่อนกว่าปกติ
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.stories.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
