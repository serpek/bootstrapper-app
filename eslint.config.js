import js from '@eslint/js'
import typescriptEslintPlugin from '@typescript-eslint/eslint-plugin'
import importPlugin from 'eslint-plugin-import'
import prettierPlugin from 'eslint-plugin-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import useDecoratorPlugin from 'eslint-plugin-use-decorator'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: globals.browser
    },
    plugins: {
      'use-decorator': useDecoratorPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      prettier: prettierPlugin,
      import: importPlugin,
      'simple-import-sort': simpleImportSort,
      '@typescript-eslint': typescriptEslintPlugin
    },
    rules: {
      // React kuralları
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true }
      ],
      'react/display-name': 'off',
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-children-prop': 'off',

      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // ✅ Özel side-effect import → reflect-metadata en başta
            ['^\\u0000reflect-metadata$'],

            // React ve 3rd party
            ['^react', '^@?\\w'],

            // Diğer side-effects
            ['^\\u0000'],

            // Internal libs
            [
              '^(~|@|@bip|@bipweb|@bip-workspace|@company|@ui||components|utils|config|vendored-lib)(/.*|$)'
            ],

            // Apps
            ['^(@apps)(/.*|$)'],

            // Parent imports
            ['^\\.\\.(?!/?$)', '^\\.\\./?$'],

            // Sibling & index imports
            ['^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],

            // Styles
            ['^.+\\.s?css$']
          ]
        }
      ],
      'simple-import-sort/exports': 'error',

      // 'import/order': [
      //   'error',
      //   {
      //     groups: [
      //       // Imports of builtins are first
      //       ['builtin', 'external', 'internal'],
      //       // Then sibling and parent imports. They can be mingled together
      //       ['sibling', 'parent'],
      //       // Then index file imports
      //       'index',
      //       // Then any arcane TypeScript imports
      //       'object'
      //       // Then the omitted imports: internal, external, type, unknown
      //     ]
      //   }
      // ],
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './*',
              from: './*',
              except: ['./*']
            },
            {
              target: '../*',
              from: '../*'
            }
          ]
        }
      ],

      // TypeScript kuralları
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',

      // Prettier entegrasyonu
      'prettier/prettier': [
        'warn',
        {
          semi: false,
          singleQuote: true,
          bracketSameLine: true,
          trailingComma: 'none',
          endOfLine: 'lf'
        }
      ],

      // Diğer kurallar
      'max-len': [
        'warn',
        {
          code: 240
        }
      ],
      'prefer-promise-reject-errors': 'off',
      radix: 'off',
      'use-decorator/use-decorator': 'warn'
    }
  }
)
