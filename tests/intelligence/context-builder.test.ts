import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { ContextBuilder } from "../../src/intelligence/context-builder.js";
import type { RetrievedMemory } from "../../src/intelligence/layer.js";

describe('ContextBuilder', () => {
  let builder: ContextBuilder;
  
  const createMemory = (overrides: Partial<RetrievedMemory> = {}): RetrievedMemory => ({
    id: 'mem_123_abc',
    content: 'Default test content',
    score: 0.95,
    timestamp: new Date('2025-01-20T10:00:00Z'),
    metadata: {
      eventType: 'code_write',
      file: 'test.ts',
      lines: 100
    },
    ...overrides
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (builder) {
      await builder.close?.().catch(() => {});
    }
  });

  describe('initialization', () => {
    it('should create builder with default options', () => {
      // When: Creating builder with no options
      builder = new ContextBuilder();
      
      // Then: Default options are applied
      const options = builder.getOptions();
      expect(options.format).toBe('markdown');
      expect(options.maxSize).toBe(8192);
      expect(options.includeMetadata).toBe(true);
      expect(options.includeScore).toBe(false);
      expect(options.deduplicateThreshold).toBe(0.95);
    });

    it('should create builder with custom options', () => {
      // Given: Custom options
      const customOptions = {
        format: 'plain' as const,
        maxSize: 4096,
        includeMetadata: false,
        includeScore: true,
        deduplicateThreshold: 0.9
      };
      
      // When: Creating builder
      builder = new ContextBuilder(customOptions);
      
      // Then: Custom options are applied
      const options = builder.getOptions();
      expect(options).toEqual(customOptions);
    });

    it('should validate options on creation', () => {
      // Given: Invalid options
      const invalidOptions = {
        format: 'invalid' as any,
        maxSize: -100
      };
      
      // When/Then: Creation throws
      expect(() => new ContextBuilder(invalidOptions)).toThrow(
        'Invalid format option: invalid'
      );
    });
  });

  describe('basic context building', () => {
    beforeEach(() => {
      builder = new ContextBuilder();
    });

    it('should build empty context for no memories', () => {
      // Given: Empty memories array
      const memories: RetrievedMemory[] = [];
      
      // When: Building context
      const context = builder.build(memories);
      
      // Then: Returns empty context with header
      expect(context).toBe('# Retrieved Context\n\nNo relevant memories found.');
    });

    it('should build context from single memory', () => {
      // Given: Single memory
      const memory = createMemory({
        content: 'Implemented user authentication',
        metadata: {
          eventType: 'code_write',
          file: 'auth.ts',
          lines: 150
        }
      });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Context includes formatted memory
      expect(context).toContain('# Retrieved Context');
      expect(context).toContain('## Memory 1');
      expect(context).toContain('Implemented user authentication');
      expect(context).toContain('**Type:** code_write');
      expect(context).toContain('**File:** auth.ts');
      expect(context).toContain('**Lines:** 150');
      expect(context).toContain('**Time:** 2025-01-20T10:00:00.000Z');
    });

    it('should build context from multiple memories', () => {
      // Given: Multiple memories
      const memories = [
        createMemory({
          content: 'First memory content',
          score: 0.98
        }),
        createMemory({
          id: 'mem_456_def',
          content: 'Second memory content',
          score: 0.85
        }),
        createMemory({
          id: 'mem_789_ghi',
          content: 'Third memory content',
          score: 0.75
        })
      ];
      
      // When: Building context
      const context = builder.build(memories);
      
      // Then: All memories included in order
      expect(context).toContain('## Memory 1');
      expect(context).toContain('First memory content');
      expect(context).toContain('## Memory 2');
      expect(context).toContain('Second memory content');
      expect(context).toContain('## Memory 3');
      expect(context).toContain('Third memory content');
    });
  });

  describe('format options', () => {
    it('should format as markdown by default', () => {
      // Given: Markdown format
      builder = new ContextBuilder({ format: 'markdown' });
      const memory = createMemory();
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Markdown formatting applied
      expect(context).toContain('# Retrieved Context');
      expect(context).toContain('## Memory 1');
      expect(context).toContain('**Type:**');
      expect(context).toContain('---'); // Memory separator
    });

    it('should format as plain text when configured', () => {
      // Given: Plain text format
      builder = new ContextBuilder({ format: 'plain' });
      const memory = createMemory();
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Plain text formatting applied
      expect(context).toContain('RETRIEVED CONTEXT');
      expect(context).toContain('Memory 1:');
      expect(context).toContain('Type: code_write');
      expect(context).not.toContain('**');
      expect(context).not.toContain('##');
      expect(context).toContain('─'.repeat(40)); // Plain text separator
    });

    it('should include scores when configured', () => {
      // Given: Score inclusion enabled
      builder = new ContextBuilder({ includeScore: true });
      const memory = createMemory({ score: 0.87 });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Score included
      expect(context).toContain('**Score:** 0.87');
    });

    it('should exclude metadata when configured', () => {
      // Given: Metadata exclusion
      builder = new ContextBuilder({ includeMetadata: false });
      const memory = createMemory();
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Metadata excluded
      expect(context).not.toContain('**Type:**');
      expect(context).not.toContain('**File:**');
      expect(context).toContain('Default test content'); // Content still included
    });
  });

  describe('size limit enforcement', () => {
    it('should truncate context when exceeding size limit', () => {
      // Given: Large memories and small size limit
      builder = new ContextBuilder({ maxSize: 500 });
      const memories = Array(10).fill(0).map((_, i) => createMemory({
        id: `mem_${i}`,
        content: `This is a very long memory content that will help exceed the size limit. Memory number ${i}.`
      }));
      
      // When: Building context
      const context = builder.build(memories);
      
      // Then: Context truncated to size limit
      expect(context.length).toBeLessThanOrEqual(500);
      expect(context).toContain('... (truncated)');
    });

    it('should prioritize higher scoring memories when truncating', () => {
      // Given: Memories with different scores and size limit
      builder = new ContextBuilder({ maxSize: 600 });
      const memories = [
        createMemory({ id: 'low', content: 'Low priority content', score: 0.5 }),
        createMemory({ id: 'high', content: 'High priority content', score: 0.95 }),
        createMemory({ id: 'medium', content: 'Medium priority content', score: 0.7 })
      ];
      
      // When: Building context
      const context = builder.build(memories);
      
      // Then: Higher scoring memories included first
      expect(context).toContain('High priority content');
      expect(context).toContain('Medium priority content');
      // Low priority might be truncated depending on exact formatting
    });

    it('should handle single memory exceeding size limit', () => {
      // Given: Single very large memory
      builder = new ContextBuilder({ maxSize: 200 });
      const memory = createMemory({
        content: 'x'.repeat(500) // Very long content
      });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Memory content truncated
      expect(context.length).toBeLessThanOrEqual(200);
      expect(context).toContain('... (truncated)');
    });
  });

  describe('memory deduplication', () => {
    it('should deduplicate similar memories', () => {
      // Given: Similar memories
      builder = new ContextBuilder({ deduplicateThreshold: 0.9 });
      const memories = [
        createMemory({ id: '1', content: 'Updated user authentication service' }),
        createMemory({ id: '2', content: 'Updated user authentication service' }), // Exact duplicate
        createMemory({ id: '3', content: 'Updated user auth service' }) // Similar
      ];
      
      // When: Building context
      const context = builder.build(memories);
      
      // Then: Only unique memories included
      expect(context.match(/## Memory \d+/g)?.length).toBe(2); // Only 2 memories
      expect(context).toContain('Updated user authentication service');
      expect(context).toContain('Updated user auth service');
    });

    it('should keep best scoring memory when deduplicating', () => {
      // Given: Duplicate memories with different scores
      builder = new ContextBuilder({ deduplicateThreshold: 0.95 });
      const memories = [
        createMemory({ id: '1', content: 'Same content here', score: 0.8 }),
        createMemory({ id: '2', content: 'Same content here', score: 0.95 }),
        createMemory({ id: '3', content: 'Same content here', score: 0.7 })
      ];
      
      // When: Building context
      const context = builder.build(memories);
      
      // Then: Only highest scoring memory kept
      expect(context.match(/## Memory \d+/g)?.length).toBe(1);
      expect(context).toContain('Same content here');
    });

    it('should not deduplicate when threshold is 1.0', () => {
      // Given: Deduplication disabled
      builder = new ContextBuilder({ deduplicateThreshold: 1.0 });
      const memories = [
        createMemory({ id: '1', content: 'Identical content' }),
        createMemory({ id: '2', content: 'Identical content' })
      ];
      
      // When: Building context
      const context = builder.build(memories);
      
      // Then: Both memories included
      expect(context.match(/## Memory \d+/g)?.length).toBe(2);
    });
  });

  describe('event-specific formatting', () => {
    beforeEach(() => {
      builder = new ContextBuilder();
    });

    it('should format code_write events specially', () => {
      // Given: Code write event
      const memory = createMemory({
        metadata: {
          eventType: 'code_write',
          file: 'src/services/auth.ts',
          lines: 250,
          language: 'typescript',
          functions: ['authenticate', 'authorize']
        }
      });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Code-specific formatting applied
      expect(context).toContain('**Type:** code_write');
      expect(context).toContain('**File:** src/services/auth.ts');
      expect(context).toContain('**Language:** typescript');
      expect(context).toContain('**Functions:** authenticate, authorize');
    });

    it('should format command_run events specially', () => {
      // Given: Command run event
      const memory = createMemory({
        content: 'npm test',
        metadata: {
          eventType: 'command_run',
          command: 'npm test',
          exitCode: 0,
          duration: 5432,
          cwd: '/project'
        }
      });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Command-specific formatting applied
      expect(context).toContain('**Command:** `npm test`');
      expect(context).toContain('**Exit Code:** 0 ✓');
      expect(context).toContain('**Duration:** 5.43s');
      expect(context).toContain('**Working Dir:** /project');
    });

    it('should format test events specially', () => {
      // Given: Test event
      const memory = createMemory({
        metadata: {
          eventType: 'test_run',
          testFile: 'auth.test.ts',
          passed: 15,
          failed: 2,
          duration: 1234
        }
      });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Test-specific formatting applied
      expect(context).toContain('**Test File:** auth.test.ts');
      expect(context).toContain('**Results:** 15 passed, 2 failed');
      expect(context).toContain('**Duration:** 1.23s');
    });

    it('should format git events specially', () => {
      // Given: Git event
      const memory = createMemory({
        metadata: {
          eventType: 'git_commit',
          hash: 'abc123',
          branch: 'feature/auth',
          author: 'developer@example.com',
          message: 'Add authentication'
        }
      });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Git-specific formatting applied
      expect(context).toContain('**Commit:** abc123');
      expect(context).toContain('**Branch:** feature/auth');
      expect(context).toContain('**Author:** developer@example.com');
      expect(context).toContain('**Message:** Add authentication');
    });

    it('should handle unknown event types gracefully', () => {
      // Given: Unknown event type
      const memory = createMemory({
        metadata: {
          eventType: 'custom_event',
          customField: 'value'
        }
      });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Generic formatting applied
      expect(context).toContain('**Type:** custom_event');
      expect(context).toContain('**customField:** value');
    });
  });

  describe('metadata handling', () => {
    beforeEach(() => {
      builder = new ContextBuilder({ includeMetadata: true });
    });

    it('should handle missing metadata gracefully', () => {
      // Given: Memory without metadata
      const memory = createMemory({ metadata: undefined });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: No metadata section, but content still shown
      expect(context).toContain('Default test content');
      expect(context).not.toContain('**Type:**');
    });

    it('should handle empty metadata object', () => {
      // Given: Empty metadata
      const memory = createMemory({ metadata: {} });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: No metadata fields shown
      expect(context).toContain('Default test content');
      expect(context).not.toContain('**Type:**');
    });

    it('should exclude sensitive metadata fields', () => {
      // Given: Metadata with sensitive fields
      const memory = createMemory({
        metadata: {
          eventType: 'code_write',
          apiKey: 'secret-key',
          password: 'secret-pass',
          token: 'auth-token',
          file: 'safe-file.ts'
        }
      });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Sensitive fields excluded
      expect(context).toContain('**Type:** code_write');
      expect(context).toContain('**File:** safe-file.ts');
      expect(context).not.toContain('apiKey');
      expect(context).not.toContain('secret-key');
      expect(context).not.toContain('password');
      expect(context).not.toContain('token');
    });

    it('should handle nested metadata objects', () => {
      // Given: Nested metadata
      const memory = createMemory({
        metadata: {
          eventType: 'api_call',
          request: {
            method: 'POST',
            url: '/api/users',
            headers: { 'content-type': 'application/json' }
          },
          response: {
            status: 201,
            time: 125
          }
        }
      });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Nested objects formatted appropriately
      expect(context).toContain('**Type:** api_call');
      expect(context).toContain('**request:**');
      expect(context).toContain('method: POST');
      expect(context).toContain('url: /api/users');
      expect(context).toContain('**response:**');
      expect(context).toContain('status: 201');
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      builder = new ContextBuilder();
    });

    it('should handle null memories array', () => {
      // When/Then: Null input handled gracefully
      expect(() => builder.build(null as any)).toThrow(
        'Memories must be an array'
      );
    });

    it('should handle memories with missing required fields', () => {
      // Given: Invalid memory objects
      const invalidMemories = [
        { content: 'No ID' } as any,
        { id: 'mem_123' } as any, // No content
        createMemory() // Valid one
      ];
      
      // When: Building context
      const context = builder.build(invalidMemories);
      
      // Then: Only valid memories included
      expect(context.match(/## Memory \d+/g)?.length).toBe(1);
      expect(context).toContain('Default test content');
    });

    it('should handle very long content gracefully', () => {
      // Given: Memory with very long content
      const longContent = 'word '.repeat(1000);
      const memory = createMemory({ content: longContent });
      builder = new ContextBuilder({ maxSize: 1000 });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Content truncated appropriately
      expect(context.length).toBeLessThanOrEqual(1000);
      expect(context).toContain('... (truncated)');
    });

    it('should handle special characters in content', () => {
      // Given: Content with special characters
      const memory = createMemory({
        content: 'Code with **markdown** and <html> tags & entities'
      });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Special characters preserved
      expect(context).toContain('**markdown**');
      expect(context).toContain('<html>');
      expect(context).toContain('&');
    });

    it('should handle memories with same timestamp', () => {
      // Given: Memories with identical timestamps
      const timestamp = new Date('2025-01-20T10:00:00Z');
      const memories = [
        createMemory({ id: '1', content: 'First', timestamp }),
        createMemory({ id: '2', content: 'Second', timestamp }),
        createMemory({ id: '3', content: 'Third', timestamp })
      ];
      
      // When: Building context
      const context = builder.build(memories);
      
      // Then: All memories included in stable order
      expect(context.indexOf('First')).toBeLessThan(context.indexOf('Second'));
      expect(context.indexOf('Second')).toBeLessThan(context.indexOf('Third'));
    });
  });

  describe('performance', () => {
    it('should handle large memory sets efficiently', () => {
      // Given: Large number of memories
      builder = new ContextBuilder();
      const memories = Array(1000).fill(0).map((_, i) => createMemory({
        id: `mem_${i}`,
        content: `Memory content ${i}`,
        score: Math.random()
      }));
      
      // When: Building context
      const start = Date.now();
      const context = builder.build(memories);
      const duration = Date.now() - start;
      
      // Then: Completes within reasonable time
      expect(duration).toBeLessThan(500); // Should complete in under 500ms
      expect(context).toBeTruthy();
    });

    it('should efficiently deduplicate large sets', () => {
      // Given: Many duplicate memories
      builder = new ContextBuilder({ deduplicateThreshold: 0.9 });
      const baseMemories = Array(10).fill(0).map((_, i) => createMemory({
        id: `base_${i}`,
        content: `Unique content ${i}`
      }));
      // Create 10 duplicates of each
      const memories = baseMemories.flatMap(m => 
        Array(10).fill(0).map((_, i) => ({
          ...m,
          id: `${m.id}_dup_${i}`,
          score: Math.random()
        }))
      );
      
      // When: Building context with deduplication
      const start = Date.now();
      const context = builder.build(memories);
      const duration = Date.now() - start;
      
      // Then: Efficiently deduplicates
      expect(duration).toBeLessThan(50);
      expect(context.match(/## Memory \d+/g)?.length).toBe(10); // Only unique ones
    });
  });

  describe('statistics and debugging', () => {
    beforeEach(() => {
      builder = new ContextBuilder();
    });

    it('should provide build statistics', () => {
      // Given: Various memories
      const memories = [
        createMemory({ content: 'First memory', score: 0.9 }),
        createMemory({ id: '2', content: 'Second memory', score: 0.8 }),
        createMemory({ id: '3', content: 'Third memory', score: 0.7 })
      ];
      
      // When: Building context
      builder.build(memories);
      const stats = builder.getLastBuildStats();
      
      // Then: Statistics available
      expect(stats).toEqual({
        inputMemories: 3,
        outputMemories: 3,
        duplicatesRemoved: 0,
        totalSize: expect.any(Number),
        truncated: false,
        buildTime: expect.any(Number)
      });
    });

    it('should track deduplication in statistics', () => {
      // Given: Duplicate memories
      builder = new ContextBuilder({ deduplicateThreshold: 0.95 });
      const memories = [
        createMemory({ content: 'Same' }),
        createMemory({ id: '2', content: 'Same' }),
        createMemory({ id: '3', content: 'Different' })
      ];
      
      // When: Building with deduplication
      builder.build(memories);
      const stats = builder.getLastBuildStats();
      
      // Then: Deduplication tracked
      expect(stats.inputMemories).toBe(3);
      expect(stats.outputMemories).toBe(2);
      expect(stats.duplicatesRemoved).toBe(1);
    });

    it('should track truncation in statistics', () => {
      // Given: Large content with size limit
      builder = new ContextBuilder({ maxSize: 200 });
      const memories = Array(10).fill(0).map((_, i) => createMemory({
        id: `${i}`,
        content: 'Long content here '.repeat(20)
      }));
      
      // When: Building with truncation
      builder.build(memories);
      const stats = builder.getLastBuildStats();
      
      // Then: Truncation tracked
      expect(stats.truncated).toBe(true);
      expect(stats.totalSize).toBeLessThanOrEqual(200);
    });
  });

  describe('custom formatters', () => {
    it('should support custom event formatters', () => {
      // Given: Custom formatter for specific event type
      const customFormatter = (memory: RetrievedMemory): string | null => {
        if (memory.metadata?.eventType === 'custom') {
          return `CUSTOM: ${memory.content.toUpperCase()}`;
        }
        return null; // Use default formatting
      };
      
      builder = new ContextBuilder({
        customFormatters: { custom: customFormatter }
      });
      
      const memory = createMemory({
        metadata: { eventType: 'custom' }
      });
      
      // When: Building context
      const context = builder.build([memory]);
      
      // Then: Custom formatter applied
      expect(context).toContain('CUSTOM: DEFAULT TEST CONTENT');
    });

    it('should chain multiple custom formatters', () => {
      // Given: Multiple formatters
      builder = new ContextBuilder({
        customFormatters: {
          highlight: (memory: RetrievedMemory): string | null => {
            if (memory.metadata?.highlight) {
              return `>>> ${memory.content} <<<`;
            }
            return null;
          },
          important: (memory: RetrievedMemory): string | null => {
            if (memory.metadata?.important) {
              return `!!! ${memory.content} !!!`;
            }
            return null;
          }
        }
      });
      
      const memories = [
        createMemory({ content: 'First content', metadata: { highlight: true } }),
        createMemory({ id: '2', content: 'Second content', metadata: { important: true } })
      ];
      
      // When: Building context
      const context = builder.build(memories);
      
      // Then: Appropriate formatters applied
      expect(context).toContain('>>> First content <<<');
      expect(context).toContain('!!! Second content !!!');
    });
  });
});