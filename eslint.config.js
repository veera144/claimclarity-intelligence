import eslint from '@eslint/js'
import importPlugin from 'eslint-plugin-import'
import tseslint from 'typescript-eslint'

// eslint-disable-next-line @typescript-eslint/no-deprecated -- MASTER_SPEC.md requires the typescript-eslint config helper shape.
export default tseslint.config(
  {
    ignores: ['**/.next/**', '**/dist/**', '**/node_modules/**']
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'apps/dashboard/next.config.mjs',
            'apps/web/next.config.mjs',
            'eslint.config.js',
            'postcss.config.js'
          ]
        }
      }
    },
    plugins: { import: importPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      'consistent-return': 'error',
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling'],
          'newlines-between': 'always'
        }
      ],
      'import/no-default-export': 'warn'
    }
  },
  {
    files: [
      '**/app/**/page.tsx',
      '**/app/**/layout.tsx',
      '**/app/**/route.ts',
      '**/app/**/error.tsx',
      '**/app/**/loading.tsx',
      '**/app/**/template.tsx',
      '**/app/**/not-found.tsx'
    ],
    rules: {
      'import/no-default-export': 'off'
    }
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off'
    }
  }
)
