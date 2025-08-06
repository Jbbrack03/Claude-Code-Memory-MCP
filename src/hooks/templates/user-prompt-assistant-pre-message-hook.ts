/**
 * Hook template for pre-processing before assistant message generation
 * Executes before Claude generates a response to inject relevant context
 */

import { BaseHookTemplate, HookEvent, HookResponse } from './base-template.js';
import { z } from 'zod';

/**
 * Schema for assistant pre-message event data
 */
const AssistantPreMessageEventSchema = z.object({
  promptId: z.string(),
  userPrompt: z.string(),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    timestamp: z.string(),
  })).optional(),
  contextRequested: z.boolean().optional(),
  maxContextTokens: z.number().optional(),
});

export class UserPromptAssistantPreMessageHook extends BaseHookTemplate {
  constructor() {
    super('user-prompt-assistant-pre-message-hook', {
      timeout: 2000, // Faster timeout for context injection
      maxRetries: 1,
    });
  }

  process(event: HookEvent): Promise<HookResponse> {
    try {
      // Validate the event
      const validatedEvent = this.validateEvent(event);
      
      // Parse and validate the specific event data
      const eventData = AssistantPreMessageEventSchema.parse(validatedEvent.data);
      
      // Extract context
      const context = this.extractContext(validatedEvent);
      
      // Determine if context injection is needed
      if (!eventData.contextRequested) {
        return Promise.resolve(this.createSuccessResponse({
          inject: false,
          reason: 'Context not requested for this prompt',
        }, context));
      }
      
      // Analyze the prompt to determine relevant context
      const contextNeeds = this.analyzeContextNeeds(
        eventData.userPrompt,
        eventData.conversationHistory
      );
      
      // Build context injection data
      const contextData = {
        inject: true,
        context: {
          relevantMemories: contextNeeds.memoryTypes,
          searchQueries: contextNeeds.searchQueries,
          maxTokens: eventData.maxContextTokens ?? 2000,
          priority: contextNeeds.priority,
        },
        metadata: {
          promptId: eventData.promptId,
          contextType: contextNeeds.type,
          estimatedRelevance: contextNeeds.relevanceScore,
        },
      };
      
      return Promise.resolve(this.createSuccessResponse(contextData, context));
      
    } catch (error) {
      return Promise.resolve(this.createErrorResponse(
        'PRE_MESSAGE_HOOK_ERROR',
        error instanceof Error ? error.message : 'Failed to process pre-message event',
        { error: error instanceof Error ? error.stack : undefined }
      ));
    }
  }
  
  /**
   * Analyze the prompt and conversation to determine context needs
   */
  private analyzeContextNeeds(
    prompt: string,
    history?: Array<{ role: string; content: string; timestamp: string }>
  ): {
    type: string;
    memoryTypes: string[];
    searchQueries: string[];
    priority: 'low' | 'medium' | 'high';
    relevanceScore: number;
  } {
    const needs = {
      type: 'general',
      memoryTypes: [] as string[],
      searchQueries: [] as string[],
      priority: 'medium' as 'low' | 'medium' | 'high',
      relevanceScore: 0.5,
    };
    
    const lowerPrompt = prompt.toLowerCase();
    
    // Check for references to previous work
    if (lowerPrompt.includes('previous') || lowerPrompt.includes('earlier') || 
        lowerPrompt.includes('last time') || lowerPrompt.includes('before')) {
      needs.memoryTypes.push('conversation_history');
      needs.priority = 'high';
      needs.relevanceScore = 0.8;
    }
    
    // Check for file references
    const fileMatches = prompt.match(/[./][\w/-]+\.\w+/g);
    if (fileMatches) {
      needs.memoryTypes.push('file_operations');
      needs.searchQueries.push(...fileMatches);
      needs.type = 'file_context';
      needs.relevanceScore = 0.9;
    }
    
    // Check for code-related queries
    if (lowerPrompt.includes('function') || lowerPrompt.includes('class') ||
        lowerPrompt.includes('method') || lowerPrompt.includes('variable') ||
        lowerPrompt.includes('implement') || lowerPrompt.includes('jwt') ||
        lowerPrompt.includes('authentication') || lowerPrompt.includes('typescript')) {
      needs.memoryTypes.push('code_analysis');
      needs.type = 'code_context';
      needs.relevanceScore = 0.85;
    }
    
    // Check for error or debugging context
    if (lowerPrompt.includes('error') || lowerPrompt.includes('bug') ||
        lowerPrompt.includes('fix') || lowerPrompt.includes('debug')) {
      needs.memoryTypes.push('error_diagnostics');
      needs.type = 'debugging_context';
      needs.priority = 'high';
      needs.relevanceScore = 0.9;
    }
    
    // Check for configuration or setup queries
    if (lowerPrompt.includes('config') || lowerPrompt.includes('setup') ||
        lowerPrompt.includes('install') || lowerPrompt.includes('environment')) {
      needs.memoryTypes.push('configuration');
      needs.type = 'setup_context';
      needs.relevanceScore = 0.75;
    }
    
    // Extract potential search terms from the prompt
    const keywords = this.extractKeywords(prompt);
    if (keywords.length > 0) {
      needs.searchQueries.push(...keywords);
    }
    
    // Analyze conversation history for context continuity
    if (history && history.length > 0) {
      const recentMessages = history.slice(-5); // Last 5 messages
      for (const msg of recentMessages) {
        if (msg.role === 'assistant' && msg.content.includes('TODO')) {
          needs.memoryTypes.push('task_tracking');
          needs.priority = 'high';
        }
      }
    }
    
    // Default to including recent memories if no specific needs identified
    if (needs.memoryTypes.length === 0) {
      needs.memoryTypes.push('recent_memories');
      needs.priority = 'low';
      needs.relevanceScore = 0.3;
    }
    
    return needs;
  }
  
  /**
   * Extract keywords from the prompt for search queries
   */
  private extractKeywords(prompt: string): string[] {
    // Remove common words and extract meaningful terms
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
      'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall',
      'please', 'help', 'me', 'my', 'how', 'what', 'when', 'where', 'why',
      'which', 'who', 'whom', 'whose', 'this', 'that', 'these', 'those',
    ]);
    
    // Extract words and filter
    const words = prompt
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
    
    // Get unique keywords
    const keywords = Array.from(new Set(words));
    
    // Limit to top 5 keywords by length (longer words are often more specific)
    return keywords
      .sort((a, b) => b.length - a.length)
      .slice(0, 5);
  }
}

/**
 * Factory function to create hook instance
 */
export function createUserPromptAssistantPreMessageHook(): UserPromptAssistantPreMessageHook {
  return new UserPromptAssistantPreMessageHook();
}