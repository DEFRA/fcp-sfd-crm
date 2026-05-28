import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['**/test/**/*.test.js'],
    setupFiles: ['test/setup/env.js'],
    coverage: {
      reportOnFailure: true,
      clean: false,
      reporter: ['lcov'],
      include: ['src/**/*.js'],
      exclude: [
        '**/node_modules/**',
        '**/test/**',
        '.server',
        'src/index.js',
        'src/data/db.js',
        'src/messaging/sqs/client.js'
      ],
      // as documented here:
      // https://eaflood.atlassian.net/wiki/spaces/SFD/pages/6123225232/SFD+Test+Strategy+Coverage
      // https://eaflood.atlassian.net/wiki/spaces/SFD/pages/5280858150/Test+Strategy
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90
      }
    }
  }
})
