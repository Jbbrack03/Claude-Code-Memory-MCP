// Trace mock behavior
process.env.NODE_ENV = 'test';

// Import to trigger the mock setup
import { ResourceMonitor } from './dist/monitoring/resource-monitor.js';

// Get the mocked os module
const os = globalThis.require('os');

console.log('=== Initial state ===');
console.log('os.freemem:', os.freemem);
console.log('os.freemem():', os.freemem());
console.log('os.freemem._value:', os.freemem._value);

console.log('\n=== After mockReturnValue ===');
os.freemem.mockReturnValue(2 * 1024 * 1024 * 1024);
console.log('os.freemem._value:', os.freemem._value);
console.log('os.freemem():', os.freemem());

// Let's check what the wrapper function sees
console.log('\n=== Checking wrapper internals ===');
// The wrapper function is looking for originalFn._value
// Let's see if we can access it through closure
console.log('typeof os.freemem:', typeof os.freemem);

// Try to fix it by updating the value on the function itself
console.log('\n=== Manual fix attempt ===');
os.freemem._value = 2 * 1024 * 1024 * 1024;
console.log('os.freemem._value after manual set:', os.freemem._value);
console.log('os.freemem():', os.freemem());