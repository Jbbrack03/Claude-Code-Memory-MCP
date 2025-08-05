// Helper functions for resource monitor tests to work with ESM context

export function setMockMemoryUsage(monitor, totalGB, freeGB) {
  const totalBytes = totalGB * 1024 * 1024 * 1024;
  const freeBytes = freeGB * 1024 * 1024 * 1024;
  monitor.setTestMemoryOverride(totalBytes, freeBytes);
}

export function setMockCpuUsage(monitor, cores, loadAvg) {
  monitor.setTestCpuOverride(cores, loadAvg);
}

export function clearMocks(monitor) {
  monitor.clearTestOverrides();
}

// Helper to wait for next collection cycle
export function waitForCollection(ms = 200) {
  return new Promise(resolve => setTimeout(resolve, ms));
}