// Debug mock behavior
const { ResourceMonitor } = require('./dist/monitoring/resource-monitor.js');

console.log('Testing mock behavior...');

// Create monitor
const monitor = new ResourceMonitor({
  enabled: true,
  monitoringInterval: 100,
  thresholds: {
    memory: { warning: 0.7, critical: 0.8, emergency: 0.9 },
    cpu: { warning: 0.7, critical: 0.8, emergency: 0.9 },
    disk: { warning: 0.8, critical: 0.9, emergency: 0.95 },
    fileDescriptors: { warning: 0.7, critical: 0.85, emergency: 0.95 }
  },
  emergencyCleanup: true,
  performanceTracking: true,
  historySize: 100,
  alertCooldown: 1000
});

// Try to use the mock
const os = require('os');
console.log('Initial freemem:', os.freemem());
console.log('Initial totalmem:', os.totalmem());

// Try to mock
if (os.freemem.mockReturnValue) {
  os.freemem.mockReturnValue(2 * 1024 * 1024 * 1024);
  console.log('After mock freemem:', os.freemem());
  
  // Check the internal values
  console.log('Mock _value:', os.freemem._value);
  console.log('Mock _impl:', os.freemem._impl);
} else {
  console.log('No mockReturnValue method found');
}

// Start monitor and check metrics
monitor.start().then(() => {
  setTimeout(() => {
    const metrics = monitor.getCurrentMetrics();
    console.log('Memory metrics:', metrics.memory);
    console.log('Memory utilization:', metrics.memory.utilization);
    
    const pressure = monitor.getPressureLevel();
    console.log('Pressure level:', pressure);
    
    monitor.stop();
  }, 200);
});