// Mock NodeSDK class
export class NodeSDK {
  constructor(config) {
    this.config = config;
    this.started = false;
    this.shutdownCalled = false;
  }
  
  async start() {
    if (this.started) {
      throw new Error('SDK already started');
    }
    this.started = true;
    return Promise.resolve();
  }
  
  async shutdown() {
    if (!this.started) {
      return Promise.resolve();
    }
    this.shutdownCalled = true;
    this.started = false;
    return Promise.resolve();
  }
  
  addResource(resource) {
    if (this.config.resource) {
      this.config.resource = this.config.resource.merge(resource);
    } else {
      this.config.resource = resource;
    }
  }
}