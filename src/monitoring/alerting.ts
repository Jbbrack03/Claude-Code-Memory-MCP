import { EventEmitter } from 'events';

export interface Alert {
  id: string;
  name: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: Date;
  labels: Record<string, string>;
  annotations?: Record<string, string>;
  source?: string;
  fingerprint?: string;
}

export interface AlertRule {
  name: string;
  condition: () => Promise<boolean>;
  severity: Alert['severity'];
  message: string | (() => string);
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  cooldown?: number; // ms
  enabled?: boolean;
}

export interface AlertHandler {
  name: string;
  handle: (alert: Alert) => Promise<void>;
  enabled?: boolean;
}

export class AlertManager extends EventEmitter {
  private rules: Map<string, AlertRule> = new Map();
  private lastFired: Map<string, number> = new Map();
  private alertHandlers: AlertHandler[] = [];
  private checkInterval?: NodeJS.Timeout;
  private alertHistory: Alert[] = [];
  private maxHistorySize = 1000;
  
  registerRule(rule: AlertRule): void {
    this.rules.set(rule.name, { enabled: true, ...rule });
  }
  
  unregisterRule(name: string): void {
    this.rules.delete(name);
    this.lastFired.delete(name);
  }
  
  registerHandler(handler: AlertHandler): void {
    this.alertHandlers.push({ enabled: true, ...handler });
  }
  
  unregisterHandler(name: string): void {
    this.alertHandlers = this.alertHandlers.filter(h => h.name !== name);
  }
  
  async checkRules(): Promise<void> {
    const checkPromises = Array.from(this.rules.values())
      .filter(rule => rule.enabled !== false)
      .map(async (rule) => {
        try {
          const shouldFire = await rule.condition();
          
          if (shouldFire) {
            const lastFiredTime = this.lastFired.get(rule.name) || 0;
            const cooldown = rule.cooldown || 300000; // 5 min default
            
            if (Date.now() - lastFiredTime > cooldown) {
              await this.fireAlert(rule);
            }
          }
        } catch (error) {
          // Log error but don't fail other checks
          console.error(`Alert rule check failed: ${rule.name}`, error);
          
          // Fire an alert about the failed alert rule
          await this.fireAlert({
            name: `alert_rule_failure_${rule.name}`,
            condition: () => Promise.resolve(true),
            severity: 'warning',
            message: `Alert rule ${rule.name} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cooldown: 3600000 // 1 hour cooldown for rule failures
          });
        }
      });
    
    await Promise.all(checkPromises);
  }
  
  private async fireAlert(rule: AlertRule): Promise<void> {
    const alert: Alert = {
      id: this.generateAlertId(rule),
      name: rule.name,
      severity: rule.severity,
      message: typeof rule.message === 'function' ? rule.message() : rule.message,
      timestamp: new Date(),
      labels: rule.labels || {},
      annotations: rule.annotations,
      source: 'claude-memory-mcp',
      fingerprint: this.generateFingerprint(rule)
    };
    
    this.lastFired.set(rule.name, Date.now());
    
    // Add to history
    this.alertHistory.unshift(alert);
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(0, this.maxHistorySize);
    }
    
    // Emit event for listeners
    this.emit('alert', alert);
    
    // Send to all enabled handlers
    const handlerPromises = this.alertHandlers
      .filter(handler => handler.enabled !== false)
      .map(async (handler) => {
        try {
          await handler.handle(alert);
        } catch (error) {
          console.error(`Alert handler ${handler.name} failed:`, error);
        }
      });
    
    await Promise.all(handlerPromises);
  }
  
  private generateAlertId(rule: AlertRule): string {
    const timestamp = Date.now();
    const hash = this.simpleHash(rule.name + timestamp);
    return `alert_${hash}`;
  }
  
  private generateFingerprint(rule: AlertRule): string {
    const data = rule.name + JSON.stringify(rule.labels || {});
    return this.simpleHash(data);
  }
  
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
  
  // Start periodic rule checking
  startChecking(intervalMs: number = 60000): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    this.checkInterval = setInterval(() => {
      this.checkRules().catch(error => {
        console.error('Alert rule checking failed:', error);
      });
    }, intervalMs);
    
    // Run initial check
    this.checkRules().catch(error => {
      console.error('Initial alert rule check failed:', error);
    });
  }
  
  // Stop periodic checking
  stopChecking(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }
  
  // Get alert history
  getAlertHistory(limit?: number): Alert[] {
    return limit ? this.alertHistory.slice(0, limit) : [...this.alertHistory];
  }
  
  // Get active alerts (alerts fired within cooldown period)
  getActiveAlerts(): Alert[] {
    const now = Date.now();
    return this.alertHistory.filter(alert => {
      const rule = this.rules.get(alert.name);
      const cooldown = rule?.cooldown || 300000;
      return now - alert.timestamp.getTime() < cooldown;
    });
  }
  
  // Manually fire an alert
  async fireManualAlert(alert: Omit<Alert, 'id' | 'timestamp' | 'source' | 'fingerprint'>): Promise<void> {
    const fullAlert: Alert = {
      ...alert,
      id: `manual_${Date.now()}`,
      timestamp: new Date(),
      source: 'manual',
      fingerprint: this.simpleHash(alert.name + JSON.stringify(alert.labels))
    };
    
    // Add to history
    this.alertHistory.unshift(fullAlert);
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(0, this.maxHistorySize);
    }
    
    // Emit event
    this.emit('alert', fullAlert);
    
    // Send to handlers
    const handlerPromises = this.alertHandlers
      .filter(handler => handler.enabled !== false)
      .map(async (handler) => {
        try {
          await handler.handle(fullAlert);
        } catch (error) {
          console.error(`Alert handler ${handler.name} failed:`, error);
        }
      });
    
    await Promise.all(handlerPromises);
  }
  
  // Register default alert rules
  registerDefaultRules(): void {
    // High memory usage
    this.registerRule({
      name: 'high_memory_usage',
      condition: () => {
        const usage = process.memoryUsage();
        const usagePercent = usage.heapUsed / usage.heapTotal;
        return Promise.resolve(usagePercent > 0.9);
      },
      severity: 'critical',
      message: () => {
        const usage = process.memoryUsage();
        const usagePercent = Math.round((usage.heapUsed / usage.heapTotal) * 100);
        return `Memory usage is critically high: ${usagePercent}%`;
      },
      labels: { component: 'system', type: 'memory' },
      cooldown: 300000 // 5 minutes
    });
    
    // High error rate (would need to be integrated with metrics)
    this.registerRule({
      name: 'high_error_rate',
      condition: () => {
        // This would check error rate from metrics
        // For now, return false as placeholder
        return Promise.resolve(false);
      },
      severity: 'error',
      message: 'Error rate is above threshold',
      labels: { component: 'application', type: 'errors' },
      cooldown: 600000 // 10 minutes
    });
    
    // Storage space warning
    this.registerRule({
      name: 'low_disk_space',
      condition: () => {
        // This would check disk space
        // For now, return false as placeholder
        return Promise.resolve(false);
      },
      severity: 'warning',
      message: 'Disk space is running low',
      labels: { component: 'storage', type: 'disk' },
      cooldown: 1800000 // 30 minutes
    });
  }
  
  // Register default alert handlers
  registerDefaultHandlers(): void {
    // Console logger handler
    this.registerHandler({
      name: 'console',
      handle: (alert: Alert) => {
        const level = alert.severity === 'critical' || alert.severity === 'error' ? 'error' : 'warn';
        const message = `[ALERT] ${alert.severity.toUpperCase()}: ${alert.message}`;
        // Using console for alerting as this is the intended behavior for alert handlers
        // eslint-disable-next-line no-console
        console[level](message, {
          alert_id: alert.id,
          name: alert.name,
          labels: alert.labels,
          timestamp: alert.timestamp.toISOString()
        });
        return Promise.resolve();
      }
    });
    
    // Webhook handler (if configured)
    if (process.env.ALERT_WEBHOOK_URL) {
      this.registerHandler({
        name: 'webhook',
        handle: async (alert: Alert) => {
          try {
            const webhookUrl = process.env.ALERT_WEBHOOK_URL;
            if (!webhookUrl) {
              throw new Error('ALERT_WEBHOOK_URL is not defined');
            }
            const response = await fetch(webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'claude-memory-mcp/alerting'
              },
              body: JSON.stringify(alert)
            });
            
            if (!response.ok) {
              throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
            }
          } catch (error) {
            console.error('Webhook alert handler failed:', error);
            throw error;
          }
        }
      });
    }
  }
  
  // Get rule status
  getRuleStatus(): Array<{
    name: string;
    enabled: boolean;
    lastFired?: Date;
    lastCheck?: Date;
  }> {
    return Array.from(this.rules.entries()).map(([name, rule]) => ({
      name,
      enabled: rule.enabled !== false,
      lastFired: this.lastFired.has(name) ? new Date(this.lastFired.get(name) ?? 0) : undefined,
      lastCheck: new Date() // Approximate since we don't track individual rule checks
    }));
  }
  
  // Enable/disable rules
  enableRule(name: string): void {
    const rule = this.rules.get(name);
    if (rule) {
      rule.enabled = true;
    }
  }
  
  disableRule(name: string): void {
    const rule = this.rules.get(name);
    if (rule) {
      rule.enabled = false;
    }
  }
  
  // Enable/disable handlers
  enableHandler(name: string): void {
    const handler = this.alertHandlers.find(h => h.name === name);
    if (handler) {
      handler.enabled = true;
    }
  }
  
  disableHandler(name: string): void {
    const handler = this.alertHandlers.find(h => h.name === name);
    if (handler) {
      handler.enabled = false;
    }
  }
}