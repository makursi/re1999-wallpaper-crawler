import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'app',
  typescript: {
    tsconfigPath: 'tsconfig.json',
  },
  stylistic: {
    indent: 2,
    quotes: 'single',
    semi: false,
  },
  ignores: [
    'dist/**',
    'images/**',
    'logs/**',
    '.playwright/**',
    'scripts/**',
    '__run_script.js',
  ],
  gitignore: true,
})
