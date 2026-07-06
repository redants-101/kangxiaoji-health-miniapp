module.exports = {
  env: {
    es6: true,
    node: true,
    jest: true
  },
  parserOptions: {
    ecmaVersion: 2020
  },
  globals: {
    wx: 'readonly',
    getApp: 'readonly',
    getCurrentPages: 'readonly',
    Component: 'readonly',
    Page: 'readonly',
    App: 'readonly'
  },
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-throw-literal': 'error',
    'eqeqeq': ['error', 'always'],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-shadow': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-unreachable': 'error',
    'no-constant-condition': 'warn',
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-unsafe-finally': 'error',
    'no-async-promise-executor': 'error',
    'require-await': 'warn',
    'no-return-await': 'error',
    'no-self-compare': 'error',
    'no-template-curly-in-string': 'error'
  },
  overrides: [
    {
      files: ['tests/**/*.js'],
      env: {
        jest: true
      },
      rules: {
        'no-console': 'off'
      }
    }
  ]
}
