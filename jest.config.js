/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  
  // Performance optimizations
  maxWorkers: '50%', // Use half of available CPU cores
  testTimeout: 120000, // 2 minute global timeout
  detectOpenHandles: true, // Find hanging operations
  forceExit: true, // Force exit after tests complete
  // testSequencer: './tests/utils/test-sequencer.js', // Temporarily disabled
  moduleNameMapper: {
    '^(\\.{1,2}/.+)\\.js$': '$1',
    '@xenova/transformers': '<rootDir>/tests/__mocks__/@xenova/transformers.js',
    'hnswlib-node': '<rootDir>/tests/__mocks__/hnswlib-node.js',
    'prom-client': '<rootDir>/tests/__mocks__/prom-client.js',
    '@opentelemetry/api': '<rootDir>/tests/__mocks__/@opentelemetry/api.js',
    '@opentelemetry/sdk-node': '<rootDir>/tests/__mocks__/@opentelemetry/sdk-node.js',
    '@opentelemetry/auto-instrumentations-node': '<rootDir>/tests/__mocks__/@opentelemetry/auto-instrumentations-node.js',
    '@opentelemetry/resources': '<rootDir>/tests/__mocks__/@opentelemetry/resources.js',
    '@opentelemetry/semantic-conventions': '<rootDir>/tests/__mocks__/@opentelemetry/semantic-conventions.js',
    '@opentelemetry/exporter-trace-otlp-http': '<rootDir>/tests/__mocks__/@opentelemetry/exporter-trace-otlp-http.js',
    '@opentelemetry/sdk-trace-base': '<rootDir>/tests/__mocks__/@opentelemetry/sdk-trace-base.js',
    '@opentelemetry/exporter-jaeger': '<rootDir>/tests/__mocks__/@opentelemetry/exporter-jaeger.js',
    '@opentelemetry/exporter-zipkin': '<rootDir>/tests/__mocks__/@opentelemetry/exporter-zipkin.js'
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          allowJs: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          skipLibCheck: true,
          strict: false,
          noUnusedLocals: false,
          noUnusedParameters: false
        }
      },
    ],
  },
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
};

export default config;