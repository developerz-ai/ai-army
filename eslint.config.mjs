// Root ESLint flat config — exists so `bin/` stays lintable after the app moved
// to apps/ai-army/.
//
// Why: ESLint flat config can only lint files under its base path, which is the
// directory of the config file in use. The app's config now lives at
// apps/ai-army/eslint.config.js, so `npm run lint --workspace apps/ai-army`
// (cwd apps/ai-army) cannot reach ../../bin/ — every file there is "outside of
// base path" and the lint run fails. The app's lint scripts therefore pass this
// file explicitly via `--config ../../eslint.config.mjs`, which makes the repo
// root the base path and covers bin/ plus apps/ai-army/{src,test}. All rule
// content stays owned by apps/ai-army/eslint.config.js; this file re-exports it
// untouched and adds one bin/-scoped object.
//
// Named eslint.config.mjs (not .js) so it always parses as ESM — the root
// package.json has no "type" field — and so the app config keeps winning
// auto-discovery for bare `eslint` runs inside apps/ai-army/.
import appConfig from './apps/ai-army/eslint.config.js';

// Config-file patterns resolve relative to the config file that declares them,
// so the app config's `files: ['**/*.js']` cannot match bin/, which stays at the
// repo root. Clone that object for bin/ so bin files get the same language
// options and rules.
const appJsConfig = appConfig.find(
  item => Array.isArray(item.files) && item.files.includes('**/*.js')
);
if (!appJsConfig) {
  throw new Error(
    'eslint.config.mjs: expected apps/ai-army/eslint.config.js to export a config object with files: ["**/*.js"]'
  );
}

export default [
  ...appConfig,

  // bin/ has no .prettierrc above it (the repo's prettier config moved to
  // apps/ai-army/.prettierrc), so pass the same prettier options inline for
  // bin files — keep this mirror in sync if that file changes.
  {
    ...appJsConfig,
    files: ['bin/**/*.js'],
    rules: {
      ...appJsConfig.rules,
      'prettier/prettier': [
        'error',
        {
          semi: true,
          trailingComma: 'es5',
          singleQuote: true,
          printWidth: 100,
          tabWidth: 2,
          useTabs: false,
          arrowParens: 'avoid',
        },
      ],
    },
  },
];
