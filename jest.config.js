/** @type {import('jest').Config} */
const config = {
  // Use the ESM preset which handles most ESM configuration
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  
  // ESM configuration
  extensionsToTreatAsEsm: ['.ts'],
  
  // Transform configuration for better coverage and compatibility
  transform: {
    // Process TypeScript files with proper ESM support
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
      }
    ]
  },
  
  // Ensure problematic modules are transformed
  transformIgnorePatterns: [
    'node_modules/(?!(@xenova/transformers|hnswlib-node)/)'
  ],
  
  // Module name mapping for ESM imports and mocks
  moduleNameMapper: {
    // Handle .js imports in TypeScript (ESM compatibility)
    '^(\\.{1,2}/.+)\\.js$': '$1',
    // Mock mappings
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
  
  // Performance optimizations
  maxWorkers: '50%', // Use half of available CPU cores
  testTimeout: 30000, // 30 second global timeout
  detectOpenHandles: true, // Find hanging operations
  forceExit: true, // Force exit after tests complete
  bail: 1, // Stop on first failure to prevent hanging
  testSequencer: './tests/utils/test-sequencer.cjs', // Custom sequencer for performance
  // setupFilesAfterEnv: ['<rootDir>/tests/setup-enhanced.ts'], // Disabled temporarily
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