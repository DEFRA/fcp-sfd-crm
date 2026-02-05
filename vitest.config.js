import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/test/**/*.test.js'],
    setupFiles: ['./test/setup-env.js'],
    coverage: {
      reportOnFailure: true,
      clean: false,
      reporter: ['lcov'],
      include: ['src/**/*.js'],
      exclude: [
        '**/node_modules/**',
        '**/test/**',
        '.server',
        'src/index.js'
      ]
    }
  }
})
