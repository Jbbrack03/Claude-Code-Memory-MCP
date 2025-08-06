/**
 * Hook template for capturing assistant messages during streaming
 * Executes as Claude streams response chunks to capture content
 */

import { BaseHookTemplate, HookEvent, HookResponse } from './base-template.js';
import { z } from 'zod';

/**
 * Schema for assistant message event data
 */
const AssistantMessageEventSchema = z.object({
  messageId: z.string(),
  promptId: z.string(),
  chunk: z.object({
    content: z.string(),
    index: z.number(),
    isFirst: z.boolean().optional(),
    isLast: z.boolean().optional(),
  }),
  messageType: z.enum(['text', 'code', 'tool_use', 'tool_result']).optional(),
  metadata: z.object({
    model: z.string().optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
  }).optional(),
});

/**
 * In-memory buffer for accumulating message chunks
 */
class MessageBuffer {
  private chunks: Map<string, Array<{ index: number; content: string }>> = new Map();
  private readonly maxBufferSize = 1024 * 1024; // 1MB max per message
  
  addChunk(messageId: string, index: number, content: string): void {
    if (!this.chunks.has(messageId)) {
      this.chunks.set(messageId, []);
    }
    
    const messageChunks = this.chunks.get(messageId);
    if (!messageChunks) {
      throw new Error(`Failed to get message chunks for messageId: ${messageId}`);
    }
    messageChunks.push({ index, content });
    
    // Check buffer size
    const totalSize = messageChunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
    if (totalSize > this.maxBufferSize) {
      throw new Error(`Message buffer exceeded maximum size of ${this.maxBufferSize} bytes`);
    }
  }
  
  getMessage(messageId: string): string | null {
    const messageChunks = this.chunks.get(messageId);
    if (!messageChunks) return null;
    
    // Sort by index and concatenate
    return messageChunks
      .sort((a, b) => a.index - b.index)
      .map(chunk => chunk.content)
      .join('');
  }
  
  clearMessage(messageId: string): void {
    this.chunks.delete(messageId);
  }
  
  clearOldMessages(_maxAge: number = 300000): void { // 5 minutes default (unused but kept for API consistency)
    // In production, would track timestamps and clear old messages
    // For now, clear all if buffer gets too large
    if (this.chunks.size > 100) {
      const messagesToKeep = Array.from(this.chunks.keys()).slice(-50);
      const newChunks = new Map<string, Array<{ index: number; content: string }>>();
      messagesToKeep.forEach(id => {
        const chunks = this.chunks.get(id);
        if (chunks) {
          newChunks.set(id, chunks);
        }
      });
      this.chunks = newChunks;
    }
  }
}

export class UserPromptAssistantMessageHook extends BaseHookTemplate {
  private messageBuffer: MessageBuffer;
  
  constructor() {
    super('user-prompt-assistant-message-hook', {
      timeout: 1000, // Fast processing for streaming
      maxRetries: 1,
    });
    this.messageBuffer = new MessageBuffer();
  }

  process(event: HookEvent): Promise<HookResponse> {
    try {
      // Validate the event
      const validatedEvent = this.validateEvent(event);
      
      // Parse and validate the specific event data
      const eventData = AssistantMessageEventSchema.parse(validatedEvent.data);
      
      // Extract context
      const context = this.extractContext(validatedEvent);
      
      // Add chunk to buffer
      this.messageBuffer.addChunk(
        eventData.messageId,
        eventData.chunk.index,
        eventData.chunk.content
      );
      
      // Analyze the chunk for immediate processing needs
      const chunkAnalysis = this.analyzeChunk(eventData.chunk.content, eventData.messageType);
      
      // Prepare response data
      const responseData: Record<string, unknown> = {
        captured: true,
        messageId: eventData.messageId,
        promptId: eventData.promptId,
        chunkIndex: eventData.chunk.index,
        analysis: chunkAnalysis,
      };
      
      // If this is the last chunk, process the complete message
      if (eventData.chunk.isLast) {
        const completeMessage = this.messageBuffer.getMessage(eventData.messageId);
        if (completeMessage) {
          const messageAnalysis = this.analyzeCompleteMessage(
            completeMessage,
            eventData.messageType
          );
          
          responseData.completeMessage = {
            content: completeMessage,
            analysis: messageAnalysis,
            shouldStore: messageAnalysis.importance > 0.5,
            indexingPriority: this.determineIndexingPriority(messageAnalysis),
          };
          
          // Clear the message from buffer after processing
          this.messageBuffer.clearMessage(eventData.messageId);
        }
      }
      
      // Periodic cleanup of old messages
      if (Math.random() < 0.01) { // 1% chance on each call
        this.messageBuffer.clearOldMessages();
      }
      
      return Promise.resolve(this.createSuccessResponse(responseData, context));
      
    } catch (error) {
      return Promise.resolve(this.createErrorResponse(
        'MESSAGE_HOOK_ERROR',
        error instanceof Error ? error.message : 'Failed to process assistant message event',
        { error: error instanceof Error ? error.stack : undefined }
      ));
    }
  }
  
  /**
   * Analyze a message chunk for immediate processing
   */
  private analyzeChunk(content: string, _messageType?: string): Record<string, unknown> {
    const analysis: Record<string, unknown> = {
      length: content.length,
      type: _messageType ?? 'text',
    };
    
    // Detect code blocks
    if (content.includes('```')) {
      analysis.hasCodeBlock = true;
    }
    
    // Detect tool usage
    if (_messageType === 'tool_use' || content.includes('<tool>')) {
      analysis.hasToolUse = true;
    }
    
    // Detect file operations
    if (content.match(/\b(created?|wrote|updated?|deleted?|modified)\b.*\.(ts|js|py|java|cpp|c|h|hpp|rs|go|rb|php)/i)) {
      analysis.hasFileOperation = true;
    }
    
    return analysis;
  }
  
  /**
   * Analyze the complete message for storage and indexing decisions
   */
  private analyzeCompleteMessage(message: string, _messageType?: string): {
    importance: number;
    categories: string[];
    hasCode: boolean;
    hasExplanation: boolean;
    hasError: boolean;
    toolsUsed: string[];
    filesModified: string[];
  } {
    const analysis = {
      importance: 0.5, // Base importance
      categories: [] as string[],
      hasCode: false,
      hasExplanation: false,
      hasError: false,
      toolsUsed: [] as string[],
      filesModified: [] as string[],
    };
    
    // Check for code content
    const codeBlocks = message.match(/```[\s\S]*?```/g);
    if (codeBlocks) {
      analysis.hasCode = true;
      analysis.categories.push('code');
      analysis.importance += 0.2;
    }
    
    // Check for explanations
    if (message.includes('because') || message.includes('therefore') || 
        message.includes('explanation') || message.includes('means that')) {
      analysis.hasExplanation = true;
      analysis.categories.push('explanation');
      analysis.importance += 0.1;
    }
    
    // Check for errors
    if (message.includes('error') || message.includes('failed') || 
        message.includes('exception') || message.includes('traceback')) {
      analysis.hasError = true;
      analysis.categories.push('error');
      analysis.importance += 0.3;
    }
    
    // Extract tool usage
    const toolMatches = message.match(/<tool>([^<]+)<\/tool>/g);
    if (toolMatches) {
      analysis.toolsUsed = toolMatches.map(match => 
        match.replace(/<\/?tool>/g, '').trim()
      );
      analysis.categories.push('tool_usage');
      analysis.importance += 0.15;
    }
    
    // Extract file modifications
    const fileMatches = message.match(/(?:created?|wrote|updated?|deleted?|modified)\s+(?:file\s+)?([./][\w/-]+\.\w+)/gi);
    if (fileMatches) {
      analysis.filesModified = fileMatches
        .map(match => {
          const fileMatch = match.match(/([./][\w/-]+\.\w+)/);
          return fileMatch ? fileMatch[1] : undefined;
        })
        .filter((file): file is string => Boolean(file));
      analysis.categories.push('file_operations');
      analysis.importance += 0.25;
    }
    
    // Adjust importance based on message length
    if (message.length > 1000) {
      analysis.importance += 0.1;
    }
    if (message.length > 5000) {
      analysis.importance += 0.1;
    }
    
    // Cap importance at 1.0
    analysis.importance = Math.min(1.0, analysis.importance);
    
    // Determine primary category
    if (analysis.categories.length === 0) {
      analysis.categories.push('general');
    }
    
    return analysis;
  }
  
  /**
   * Determine indexing priority based on message analysis
   */
  private determineIndexingPriority(analysis: ReturnType<typeof this.analyzeCompleteMessage>): 'low' | 'medium' | 'high' {
    if (analysis.importance >= 0.8) return 'high';
    if (analysis.importance >= 0.5) return 'medium';
    return 'low';
  }
}

/**
 * Factory function to create hook instance
 */
export function createUserPromptAssistantMessageHook(): UserPromptAssistantMessageHook {
  return new UserPromptAssistantMessageHook();
}