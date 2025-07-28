import { createLogger } from "../utils/logger.js";
import type { RetrievedMemory } from "./layer.js";

const logger = createLogger("ContextBuilder");

// Sensitive fields to exclude from metadata
const SENSITIVE_FIELDS = ['apiKey', 'password', 'token', 'secret', 'key', 'auth'];

export interface ContextBuilderOptions {
  format?: 'markdown' | 'plain';
  maxSize?: number;
  includeMetadata?: boolean;
  includeScore?: boolean;
  deduplicateThreshold?: number;
  customFormatters?: Record<string, (memory: RetrievedMemory) => string | null>;
}

export interface BuildStatistics {
  inputMemories: number;
  outputMemories: number;
  duplicatesRemoved: number;
  totalSize: number;
  truncated: boolean;
  buildTime: number;
}

export class ContextBuilder {
  private options: Required<Omit<ContextBuilderOptions, 'customFormatters'>> & { customFormatters?: Record<string, (memory: RetrievedMemory) => string | null> };
  private lastBuildStats?: BuildStatistics;

  constructor(options: ContextBuilderOptions = {}) {
    // Validate format option
    if (options.format && !['markdown', 'plain'].includes(options.format)) {
      throw new Error(`Invalid format option: ${options.format}`);
    }

    // Validate maxSize
    if (options.maxSize !== undefined && options.maxSize < 0) {
      throw new Error(`Invalid maxSize option: ${options.maxSize} (must be >= 0)`);
    }

    this.options = {
      format: options.format || 'markdown',
      maxSize: options.maxSize || 8192,
      includeMetadata: options.includeMetadata ?? true,
      includeScore: options.includeScore ?? false,
      deduplicateThreshold: options.deduplicateThreshold ?? 0.95,
      customFormatters: options.customFormatters
    };
  }

  getOptions(): Required<Omit<ContextBuilderOptions, 'customFormatters'>> {
    const { customFormatters, ...rest } = this.options;
    void customFormatters; // Unused but needed for destructuring
    return rest;
  }

  build(memories: RetrievedMemory[]): string {
    const startTime = Date.now();

    // Validate input
    if (!Array.isArray(memories)) {
      throw new Error('Memories must be an array');
    }

    // Filter valid memories
    const validMemories = memories.filter(m => m?.id && m?.content);

    // Deduplicate if needed
    const deduplicated = this.deduplicateMemories(validMemories);
    const duplicatesRemoved = validMemories.length - deduplicated.length;

    // Sort by score (highest first) for prioritization
    const sorted = [...deduplicated].sort((a, b) => b.score - a.score);

    // Build context
    let context = this.buildHeader();
    let currentSize = context.length;
    const outputMemories: RetrievedMemory[] = [];
    let truncated = false;

    if (sorted.length === 0) {
      context += this.formatEmptyContext();
    } else {
      for (let i = 0; i < sorted.length; i++) {
        const memory = sorted[i];
        if (!memory) continue;
        const formatted = this.formatMemory(memory, i + 1);
        
        // Check if adding this memory would exceed size limit
        if (currentSize + formatted.length > this.options.maxSize) {
          // Try to add truncated version
          const remainingSpace = this.options.maxSize - currentSize - 20; // Reserve space for truncation marker
          if (remainingSpace > 100) {
            const truncatedMemory = this.truncateMemory(formatted, remainingSpace);
            context += truncatedMemory + '\n... (truncated)';
            outputMemories.push(memory);
          } else {
            context += '\n... (truncated)';
          }
          truncated = true;
          break;
        }

        context += formatted;
        currentSize = context.length;
        outputMemories.push(memory);
      }
    }

    // Record statistics
    this.lastBuildStats = {
      inputMemories: memories.length,
      outputMemories: outputMemories.length,
      duplicatesRemoved,
      totalSize: context.length,
      truncated,
      buildTime: Date.now() - startTime
    };

    return context;
  }

  getLastBuildStats(): BuildStatistics {
    if (!this.lastBuildStats) {
      throw new Error('No build statistics available. Call build() first.');
    }
    return this.lastBuildStats;
  }

  private buildHeader(): string {
    if (this.options.format === 'markdown') {
      return '# Retrieved Context\n\n';
    } else {
      return 'RETRIEVED CONTEXT\n\n';
    }
  }

  private formatEmptyContext(): string {
    return 'No relevant memories found.';
  }

  private formatMemory(memory: RetrievedMemory, index: number): string {
    // Check custom formatters first
    if (this.options.customFormatters) {
      for (const [, formatter] of Object.entries(this.options.customFormatters)) {
        const customFormat = formatter(memory);
        if (customFormat !== null) {
          return this.wrapMemory(customFormat, index);
        }
      }
    }

    // Use event-specific formatting
    let formatted = '';

    if (this.options.format === 'markdown') {
      formatted = `## Memory ${index}\n\n`;
      formatted += `${memory.content}\n\n`;

      if (this.options.includeScore) {
        formatted += `**Score:** ${memory.score}\n`;
      }

      if (this.options.includeMetadata && memory.metadata) {
        formatted += this.formatMetadataMarkdown(memory.metadata);
      }

      formatted += `**Time:** ${memory.timestamp.toISOString()}\n`;
      formatted += '\n---\n\n';
    } else {
      formatted = `Memory ${index}:\n`;
      formatted += `${memory.content}\n\n`;

      if (this.options.includeScore) {
        formatted += `Score: ${memory.score}\n`;
      }

      if (this.options.includeMetadata && memory.metadata) {
        formatted += this.formatMetadataPlain(memory.metadata);
      }

      formatted += `Time: ${memory.timestamp.toISOString()}\n`;
      formatted += '\n' + '─'.repeat(40) + '\n\n';
    }

    return formatted;
  }

  private wrapMemory(content: string, index: number): string {
    if (this.options.format === 'markdown') {
      return `## Memory ${index}\n\n${content}\n\n---\n\n`;
    } else {
      return `Memory ${index}:\n${content}\n\n${'─'.repeat(40)}\n\n`;
    }
  }

  private formatMetadataMarkdown(metadata: Record<string, unknown>): string {
    let result = '';
    const eventType = metadata.eventType;

    // Event-specific formatting
    switch (eventType) {
      case 'code_write':
        result += `**Type:** ${eventType}\n`;
        if (metadata.file) result += `**File:** ${String(metadata.file)}\n`;
        if (metadata.lines) result += `**Lines:** ${String(metadata.lines)}\n`;
        if (metadata.language) result += `**Language:** ${String(metadata.language)}\n`;
        if (metadata.functions && Array.isArray(metadata.functions)) result += `**Functions:** ${metadata.functions.map(String).join(', ')}\n`;
        break;

      case 'command_run':
        result += `**Type:** ${eventType}\n`;
        if (metadata.command) result += `**Command:** \`${String(metadata.command)}\`\n`;
        if (metadata.exitCode !== undefined) result += `**Exit Code:** ${String(metadata.exitCode)}${metadata.exitCode === 0 ? ' ✓' : ''}\n`;
        if (metadata.duration && typeof metadata.duration === 'number') result += `**Duration:** ${(metadata.duration / 1000).toFixed(2)}s\n`;
        if (metadata.cwd) result += `**Working Dir:** ${String(metadata.cwd)}\n`;
        break;

      case 'test_run':
        result += `**Type:** ${eventType}\n`;
        if (metadata.testFile) result += `**Test File:** ${String(metadata.testFile)}\n`;
        if (metadata.passed !== undefined && metadata.failed !== undefined) {
          result += `**Results:** ${String(metadata.passed)} passed, ${String(metadata.failed)} failed\n`;
        }
        if (metadata.duration && typeof metadata.duration === 'number') result += `**Duration:** ${(metadata.duration / 1000).toFixed(2)}s\n`;
        break;

      case 'git_commit':
        result += `**Type:** ${eventType}\n`;
        if (metadata.hash) result += `**Commit:** ${String(metadata.hash)}\n`;
        if (metadata.branch) result += `**Branch:** ${String(metadata.branch)}\n`;
        if (metadata.author) result += `**Author:** ${String(metadata.author)}\n`;
        if (metadata.message) result += `**Message:** ${String(metadata.message)}\n`;
        break;

      default:
        // Generic formatting for unknown types
        for (const [key, value] of Object.entries(metadata)) {
          if (!this.isSensitiveField(key)) {
            // Special handling for eventType to show as "Type"
            const displayKey = key === 'eventType' ? 'Type' : key;
            result += this.formatMetadataField(displayKey, value, '**');
          }
        }
    }

    return result;
  }

  private formatMetadataPlain(metadata: Record<string, unknown>): string {
    let result = '';
    const eventType = metadata.eventType;

    // Event-specific formatting (plain text version)
    switch (eventType) {
      case 'code_write':
        result += `Type: ${eventType}\n`;
        if (metadata.file) result += `File: ${String(metadata.file)}\n`;
        if (metadata.lines) result += `Lines: ${String(metadata.lines)}\n`;
        if (metadata.language) result += `Language: ${String(metadata.language)}\n`;
        if (metadata.functions && Array.isArray(metadata.functions)) result += `Functions: ${metadata.functions.map(String).join(', ')}\n`;
        break;

      case 'command_run':
        result += `Type: ${eventType}\n`;
        if (metadata.command) result += `Command: ${String(metadata.command)}\n`;
        if (metadata.exitCode !== undefined) result += `Exit Code: ${String(metadata.exitCode)}${metadata.exitCode === 0 ? ' ✓' : ''}\n`;
        if (metadata.duration && typeof metadata.duration === 'number') result += `Duration: ${(metadata.duration / 1000).toFixed(2)}s\n`;
        if (metadata.cwd) result += `Working Dir: ${String(metadata.cwd)}\n`;
        break;

      case 'test_run':
        result += `Type: ${eventType}\n`;
        if (metadata.testFile) result += `Test File: ${String(metadata.testFile)}\n`;
        if (metadata.passed !== undefined && metadata.failed !== undefined) {
          result += `Results: ${String(metadata.passed)} passed, ${String(metadata.failed)} failed\n`;
        }
        if (metadata.duration && typeof metadata.duration === 'number') result += `Duration: ${(metadata.duration / 1000).toFixed(2)}s\n`;
        break;

      case 'git_commit':
        result += `Type: ${eventType}\n`;
        if (metadata.hash) result += `Commit: ${String(metadata.hash)}\n`;
        if (metadata.branch) result += `Branch: ${String(metadata.branch)}\n`;
        if (metadata.author) result += `Author: ${String(metadata.author)}\n`;
        if (metadata.message) result += `Message: ${String(metadata.message)}\n`;
        break;

      default:
        // Generic formatting for unknown types
        for (const [key, value] of Object.entries(metadata)) {
          if (!this.isSensitiveField(key)) {
            // Special handling for eventType to show as "Type"
            const displayKey = key === 'eventType' ? 'Type' : key;
            result += this.formatMetadataField(displayKey, value, '');
          }
        }
    }

    return result;
  }

  private formatMetadataField(key: string, value: unknown, prefix: string): string {
    if (typeof value === 'object' && value !== null) {
      // Handle nested objects
      let result = `${prefix}${key}:${prefix ? '**' : ''}\n`;
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (!this.isSensitiveField(nestedKey)) {
          result += `  ${nestedKey}: ${nestedValue}\n`;
        }
      }
      return result;
    } else {
      return `${prefix}${key}:${prefix ? '**' : ''} ${String(value)}\n`;
    }
  }

  private isSensitiveField(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return SENSITIVE_FIELDS.some(field => lowerKey.includes(field));
  }

  private deduplicateMemories(memories: RetrievedMemory[]): RetrievedMemory[] {
    if (this.options.deduplicateThreshold >= 1.0) {
      return memories;
    }

    const deduplicated: RetrievedMemory[] = [];
    const seen = new Set<string>();

    // Sort by score descending to keep best scores
    const sorted = [...memories].sort((a, b) => b.score - a.score);

    for (const memory of sorted) {
      const normalized = this.normalizeContent(memory.content);
      let isDuplicate = false;

      for (const seenContent of seen) {
        const similarity = this.jaccardSimilarity(normalized, seenContent);
        if (similarity >= this.options.deduplicateThreshold) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        deduplicated.push(memory);
        seen.add(normalized);
      }
    }

    // Restore original order
    return memories.filter(m => deduplicated.includes(m));
  }

  private normalizeContent(content: string): string {
    return content.toLowerCase().trim();
  }

  private jaccardSimilarity(str1: string, str2: string): number {
    const set1 = new Set(str1.split(/\s+/));
    const set2 = new Set(str2.split(/\s+/));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return union.size === 0 ? 1 : intersection.size / union.size;
  }

  private truncateMemory(memory: string, maxLength: number): string {
    if (memory.length <= maxLength) {
      return memory;
    }

    // Find a good break point
    const breakPoint = memory.lastIndexOf('\n', maxLength);
    if (breakPoint > maxLength * 0.8) {
      return memory.substring(0, breakPoint);
    }

    return memory.substring(0, maxLength);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async close(): Promise<void> {
    // Cleanup if needed
    logger.debug("Closing context builder");
  }
}