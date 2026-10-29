import js from '@eslint/js'
import globals from 'globals'
import pluginVue from 'eslint-plugin-vue'
// @ts-ignore: look into the types for this
import pluginQuasar from '@quasar/app-vite/eslint'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'

// Quasar props that render their value as HTML (QSelect's and QChatMessage's), in both spellings
const quasarHtmlProps = [
  'options-html', 'display-value-html',
  'label-html', 'name-html', 'text-html', 'stamp-html',
].flatMap(name => [name, name.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())])

export default defineConfigWithVueTs(
  {
    /**
     * Ignore the following files.
     * Please note that pluginQuasar.configs.recommended() already ignores
     * the "node_modules" folder for you (and all other Quasar project
     * relevant folders and files).
     *
     * ESLint requires "ignores" key to be the only one in this object
     */
    ignores: [
      'src-capacitor', // Separate Capacitor project with native/generated files
      'src-electron', // Exclude all files in src-electron
      'test/e2e/test-dapp', // Separate Vite app with its own tsconfig
    ],
  },

  pluginQuasar.configs.recommended(),
  js.configs.recommended,

  /**
   * https://eslint.vuejs.org
   *
   * pluginVue.configs.base
   *   -> Settings and rules to enable correct ESLint parsing.
   * pluginVue.configs[ 'flat/essential']
   *   -> base, plus rules to prevent errors or unintended behavior.
   * pluginVue.configs["flat/strongly-recommended"]
   *   -> Above, plus rules to considerably improve code readability and/or dev experience.
   * pluginVue.configs["flat/recommended"]
   *   -> Above, plus rules to enforce subjective community defaults to ensure consistency.
   */
  pluginVue.configs[ 'flat/essential' ],

  {
    files: ['**/*.ts', '**/*.vue'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' }
      ],
    }
  },
  // https://github.com/vuejs/eslint-config-typescript
  vueTsConfigs.recommendedTypeChecked,

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',

      globals: {
        ...globals.browser,
        ...globals.node, // SSR, Electron, config files
        process: 'readonly', // process.env.*
        ga: 'readonly', // Google Analytics
        cordova: 'readonly',
        Capacitor: 'readonly',
        chrome: 'readonly', // BEX related
        browser: 'readonly' // BEX related
      }
    },

    // add your custom rules here
    rules: {
      "@typescript-eslint/ban-ts-comment": 'off',
      // unsafe enum comparison
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',
      // error handling
      '@typescript-eslint/only-throw-error': 'error',
      'prefer-promise-reject-errors': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      // promise based issues
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowTernary: true } // Allow function calls and other expressions in ternaries
      ],

      // A wallet renders untrusted text (token metadata, dApp metadata, labels) next to its keys,
      // so markup only enters the DOM through an explicit, reviewed exception.
      'vue/no-v-html': 'error',
      'vue/no-restricted-v-bind': ['error', 'innerHTML', 'outerHTML', ...quasarHtmlProps],
      'vue/no-restricted-static-attribute': ['error', ...quasarHtmlProps],
      // no runtime code from strings, and randomness comes from crypto.getRandomValues
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-restricted-properties': ['error', {
        object: 'Math', property: 'random',
        message: 'Use crypto.getRandomValues: Math.random is predictable.',
      }],

      // allow debugger during development only
      'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off'
    }
  },

  {
    // Spending must go through store.spend, which narrows mainnet-js's coin selection to the
    // spendable pool so a reserved coin can never be picked up as an incidental input. Calling
    // the wallet's spending methods directly bypasses that, and the result does not fail: the
    // transaction is built and broadcast, having quietly spent a coin something was holding.
    // This guards against forgetting, not against evasion: it matches store.wallet.send(), the
    // shape the codebase actually writes, and not a destructured wallet ref.
    files: ['src/**/*.ts', 'src/**/*.vue'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...['send', 'sendMax', 'tokenGenesis', 'tokenMint', 'tokenBurn', 'getMaxAmountToSend'].map(method => ({
          selector: `CallExpression > MemberExpression[property.name='${method}'][object.property.name='wallet']`,
          message: `Use store.spend.${method}() instead of store.wallet.${method}(), so coin selection stays narrowed to the spendable pool and cannot pick up a reserved coin.`,
        })),
        // The HTML sinks vue/no-v-html cannot see. They share this rule because a second
        // no-restricted-syntax entry for the same files would replace the one above.
        {
          selector: "Property[key.name='html'][value.value=true]",
          message: 'Quasar renders the message as HTML with html: true. Keep it text, with white-space: pre-line for line breaks.',
        },
        {
          selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
          message: 'Build DOM nodes or use textContent instead of assigning HTML.',
        },
        {
          selector: "CallExpression[callee.property.name=/^(insertAdjacentHTML|createContextualFragment)$/]",
          message: 'Build DOM nodes instead of inserting HTML.',
        },
        {
          selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
          message: 'Build DOM nodes instead of writing HTML into the document.',
        },
      ],
    }
  },

  {
    files: [ 'src-pwa/custom-service-worker.ts' ],
    languageOptions: {
      globals: {
        ...globals.serviceworker
      }
    }
  }
)
