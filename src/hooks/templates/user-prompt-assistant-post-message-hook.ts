/**
 * Hook template for post-processing complete assistant responses
 * Executes after Claude completes a response for final memory storage
 */

import { BaseHookTemplate, HookEvent, HookResponse } from './base-template.js';
import { z } from 'zod';
import crypto from 'crypto';

/**
 * Schema for assistant post-message event data
 */
const AssistantPostMessageEventSchema = z.object({
  messageId: z.string(),
  promptId: z.string(),
  userPrompt: z.string(),
  assistantResponse: z.string(),
  conversationId: z.string().optional(),
  metadata: z.object({
    model: z.string().optional(),
    tokensUsed: z.number().optional(),
    executionTime: z.number().optional(),
    toolsUsed: z.array(z.string()).optional(),
    filesModified: z.array(z.string()).optional(),
  }).optional(),
  outcome: z.object({
    success: z.boolean(),
    errorCount: z.number().optional(),
    warningCount: z.number().optional(),
  }).optional(),
});

export class UserPromptAssistantPostMessageHook extends BaseHookTemplate {
  constructor() {
    super('user-prompt-assistant-post-message-hook', {
      timeout: 5000,
      maxRetries: 2,
    });
  }

  process(event: HookEvent): Promise<HookResponse> {
    try {
      // Validate the event
      const validatedEvent = this.validateEvent(event);
      
      // Parse and validate the specific event data
      const eventData = AssistantPostMessageEventSchema.parse(validatedEvent.data);
      
      // Extract context
      const context = this.extractContext(validatedEvent);
      
      // Generate comprehensive memory entry
      const memoryEntry = this.createMemoryEntry(eventData, context);
      
      // Analyze conversation quality
      const qualityScore = this.analyzeConversationQuality(
        eventData.userPrompt,
        eventData.assistantResponse,
        eventData.outcome
      );
      
      // Determine storage strategy
      const storageStrategy = this.determineStorageStrategy(
        memoryEntry,
        qualityScore
      );
      
      // Prepare response data
      const responseData = {
        store: storageStrategy.shouldStore,
        memoryEntry: storageStrategy.shouldStore ? memoryEntry : undefined,
        indexing: {
          enabled: storageStrategy.enableIndexing,
          priority: storageStrategy.priority,
          ttl: storageStrategy.ttl,
        },
        quality: {
          score: qualityScore,
          factors: this.getQualityFactors(qualityScore),
        },
        crossReference: {
          promptId: eventData.promptId,
          messageId: eventData.messageId,
          conversationId: eventData.conversationId,
        },
      };
      
      return Promise.resolve(this.createSuccessResponse(responseData, context));
      
    } catch (error) {
      return Promise.resolve(this.createErrorResponse(
        'POST_MESSAGE_HOOK_ERROR',
        error instanceof Error ? error.message : 'Failed to process post-message event',
        { error: error instanceof Error ? error.stack : undefined }
      ));
    }
  }
  
  /**
   * Create a comprehensive memory entry from the conversation
   */
  private createMemoryEntry(
    eventData: z.infer<typeof AssistantPostMessageEventSchema>,
    context: { workspaceId: string; sessionId: string }
  ): Record<string, unknown> {
    // Generate unique ID for the memory
    const memoryId = crypto
      .createHash('sha256')
      .update(`${eventData.promptId}-${eventData.messageId}`)
      .digest('hex')
      .substring(0, 16);
    
    // Extract key information
    const tags = this.extractTags(eventData.userPrompt, eventData.assistantResponse);
    const summary = this.generateSummary(eventData.userPrompt, eventData.assistantResponse);
    const artifacts = this.extractArtifacts(eventData);
    
    return {
      id: memoryId,
      type: 'conversation',
      timestamp: new Date().toISOString(),
      workspace: context.workspaceId,
      session: context.sessionId,
      conversation: {
        promptId: eventData.promptId,
        messageId: eventData.messageId,
        conversationId: eventData.conversationId,
      },
      content: {
        userPrompt: eventData.userPrompt,
        assistantResponse: eventData.assistantResponse,
        summary,
      },
      metadata: {
        model: eventData.metadata?.model,
        tokensUsed: eventData.metadata?.tokensUsed,
        executionTime: eventData.metadata?.executionTime,
        outcome: eventData.outcome,
      },
      artifacts,
      tags,
      searchableText: this.createSearchableText(
        eventData.userPrompt,
        eventData.assistantResponse,
        summary
      ),
    };
  }
  
  /**
   * Extract tags from the conversation for categorization
   */
  private extractTags(prompt: string, response: string): string[] {
    const tags = new Set<string>();
    const combined = `${prompt} ${response}`.toLowerCase();
    
    // Programming languages
    const languages = ['javascript', 'typescript', 'python', 'java', 'rust', 'go', 'cpp', 'c++'];
    for (const lang of languages) {
      if (combined.includes(lang)) {
        tags.add(lang);
      }
    }
    
    // Frameworks and libraries
    const frameworks = ['react', 'vue', 'angular', 'express', 'django', 'flask', 'spring'];
    for (const framework of frameworks) {
      if (combined.includes(framework)) {
        tags.add(framework);
      }
    }
    
    // Task types
    if (combined.includes('debug') || combined.includes('error') || combined.includes('fix')) {
      tags.add('debugging');
    }
    if (combined.includes('implement') || combined.includes('create') || combined.includes('build')) {
      tags.add('implementation');
    }
    if (combined.includes('refactor') || combined.includes('improve') || combined.includes('optimize')) {
      tags.add('refactoring');
    }
    if (combined.includes('test') || combined.includes('spec') || combined.includes('jest')) {
      tags.add('testing');
    }
    if (combined.includes('document') || combined.includes('comment') || combined.includes('readme')) {
      tags.add('documentation');
    }
    
    return Array.from(tags);
  }
  
  /**
   * Generate a concise summary of the conversation
   */
  private generateSummary(prompt: string, response: string): string {
    // Extract first meaningful sentence from prompt
    const promptSentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const promptSummary = promptSentences[0]?.trim() || prompt.substring(0, 100);
    
    // Identify main action from response
    let actionSummary = 'Provided assistance';
    
    if (response.includes('created') || response.includes('implemented')) {
      actionSummary = 'Created implementation';
    } else if (response.includes('fixed') || response.includes('resolved')) {
      actionSummary = 'Fixed issue';
    } else if (response.includes('explained') || response.includes('described')) {
      actionSummary = 'Provided explanation';
    } else if (response.includes('analyzed') || response.includes('reviewed')) {
      actionSummary = 'Performed analysis';
    } else if (response.includes('suggested') || response.includes('recommended')) {
      actionSummary = 'Provided recommendations';
    }
    
    return `${actionSummary} for: ${promptSummary}`.substring(0, 200);
  }
  
  /**
   * Extract artifacts (code, files, tools) from the event
   */
  private extractArtifacts(
    eventData: z.infer<typeof AssistantPostMessageEventSchema>
  ): Record<string, unknown> {
    const artifacts: Record<string, unknown> = {};
    
    // Tools used
    if (eventData.metadata?.toolsUsed && eventData.metadata.toolsUsed.length > 0) {
      artifacts.tools = eventData.metadata.toolsUsed;
    }
    
    // Files modified
    if (eventData.metadata?.filesModified && eventData.metadata.filesModified.length > 0) {
      artifacts.files = eventData.metadata.filesModified;
    }
    
    // Extract code blocks from response
    const codeBlocks = eventData.assistantResponse.match(/```(\w+)?\n([\s\S]*?)```/g);
    if (codeBlocks) {
      artifacts.codeBlocks = codeBlocks.map(block => {
        const langMatch = block.match(/```(\w+)/);
        const codeMatch = block.match(/```\w*\n([\s\S]*?)```/);
        return {
          language: langMatch?.[1] || 'unknown',
          code: codeMatch?.[1] || '',
        };
      });
    }
    
    return artifacts;
  }
  
  /**
   * Create searchable text for vector indexing
   */
  private createSearchableText(prompt: string, response: string, summary: string): string {
    // Combine key text elements for searching
    const searchable = [
      summary,
      prompt.substring(0, 500),
      // Extract key sentences from response
      response
        .split(/[.!?]+/)
        .filter(s => s.trim().length > 20)
        .slice(0, 5)
        .join(' '),
    ].join(' ');
    
    // Remove code blocks for cleaner text search
    return searchable.replace(/```[\s\S]*?```/g, '').substring(0, 1000);
  }
  
  /**
   * Analyze the quality of the conversation
   */
  private analyzeConversationQuality(
    _prompt: string,
    response: string,
    outcome?: { success: boolean; errorCount?: number; warningCount?: number }
  ): number {
    let score = 0.5; // Base score
    
    // Check outcome success
    if (outcome?.success) {
      score += 0.2;
    } else if (outcome?.success === false) {
      score -= 0.2;
    }
    
    // Check for errors and warnings
    if (outcome?.errorCount && outcome.errorCount > 0) {
      score -= 0.1 * Math.min(outcome.errorCount, 3);
    }
    if (outcome?.warningCount && outcome.warningCount > 0) {
      score -= 0.05 * Math.min(outcome.warningCount, 3);
    }
    
    // Check response completeness
    if (response.length > 100) score += 0.1;
    if (response.length > 500) score += 0.1;
    
    // Check for code or actionable content
    if (response.includes('```')) score += 0.15;
    if (response.match(/\b(created?|updated?|fixed|implemented|resolved)\b/i)) score += 0.15;
    
    // Check for explanation quality
    if (response.includes('because') || response.includes('therefore')) score += 0.05;
    
    // Normalize score between 0 and 1
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Determine storage strategy based on memory content and quality
   */
  private determineStorageStrategy(
    memoryEntry: Record<string, unknown>,
    qualityScore: number
  ): {
    shouldStore: boolean;
    enableIndexing: boolean;
    priority: 'low' | 'medium' | 'high';
    ttl?: number;
  } {
    // Always store high-quality conversations
    if (qualityScore >= 0.7) {
      return {
        shouldStore: true,
        enableIndexing: true,
        priority: 'high',
      };
    }
    
    // Store medium quality with lower priority
    if (qualityScore >= 0.4) {
      return {
        shouldStore: true,
        enableIndexing: true,
        priority: 'medium',
        ttl: 30 * 24 * 60 * 60 * 1000, // 30 days
      };
    }
    
    // Only store low quality if it has artifacts
    const artifacts = memoryEntry.artifacts as Record<string, unknown>;
    if (artifacts && Object.keys(artifacts).length > 0) {
      return {
        shouldStore: true,
        enableIndexing: false,
        priority: 'low',
        ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
      };
    }
    
    // Don't store very low quality without artifacts
    return {
      shouldStore: false,
      enableIndexing: false,
      priority: 'low',
    };
  }
  
  /**
   * Get quality factors for debugging
   */
  private getQualityFactors(score: number): string[] {
    const factors = [];
    
    if (score >= 0.8) factors.push('high_quality_conversation');
    if (score >= 0.6) factors.push('complete_response');
    if (score >= 0.4) factors.push('actionable_content');
    if (score < 0.4) factors.push('low_quality_interaction');
    if (score < 0.2) factors.push('minimal_value');
    
    return factors;
  }
}

/**
 * Factory function to create hook instance
 */
export function createUserPromptAssistantPostMessageHook(): UserPromptAssistantPostMessageHook {
  return new UserPromptAssistantPostMessageHook();
}