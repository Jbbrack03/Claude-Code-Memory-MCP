import { VectorStore, VectorResult, VectorSearchOptions, Metadata } from "../storage/vector-store.js";
import { VectorIndex, SimpleVectorIndex } from "./vector-index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("VectorIndexIntegration");

/**
 * Adapter to use SimpleVectorIndex within VectorStore for improved performance.
 * This demonstrates how the SimpleVectorIndex can be integrated with the existing
 * VectorStore infrastructure while maintaining compatibility.
 */
export class IndexedVectorStore {
  private vectorStore: VectorStore;
  private index: VectorIndex;
  private idToMetadata: Map<string, unknown> = new Map();

  constructor(vectorStore: VectorStore, index?: VectorIndex) {
    this.vectorStore = vectorStore;
    this.index = index || new SimpleVectorIndex();
  }

  /**
   * Build the index from existing vectors in the store
   */
  async buildIndex(): Promise<void> {
    logger.info("Building vector index from store...");
    
    // Get all vectors from the store
    // Note: This is a simplified approach. In production, you'd want batch processing
    const allVectors = this.vectorStore.getBatchByFilter({}, { offset: 0, limit: 10000 });
    
    for (const result of allVectors) {
      await this.index.add(result.id, result.vector);
      this.idToMetadata.set(result.id, result.metadata);
    }
    
    logger.info(`Index built with ${this.index.size()} vectors`);
  }

  /**
   * Search using the index for better performance
   */
  async searchWithIndex(queryVector: number[], options: VectorSearchOptions): Promise<VectorResult[]> {
    // Use the index for initial candidate selection
    const candidates = await this.index.search(queryVector, options.k * 2); // Get more candidates for filtering
    
    // Apply filters and retrieve full results
    const results: VectorResult[] = [];
    
    for (const candidate of candidates) {
      // Check threshold
      if (options.threshold !== undefined && candidate.score < options.threshold) {
        continue;
      }
      
      // Apply metadata filter
      const metadata = this.idToMetadata.get(candidate.id);
      if (options.filter && metadata) {
        // Simple filter check (would need full implementation in production)
        let passesFilter = true;
        for (const [key, value] of Object.entries(options.filter)) {
          if ((metadata as Record<string, unknown>)[key] !== value) {
            passesFilter = false;
            break;
          }
        }
        if (!passesFilter) continue;
      }
      
      // Get full result from store
      const fullResult = await this.vectorStore.get(candidate.id);
      if (fullResult) {
        results.push({
          ...fullResult,
          score: candidate.score
        });
      }
      
      if (results.length >= options.k) break;
    }
    
    return results;
  }

  /**
   * Add a vector to both store and index
   */
  async addVector(vector: number[], metadata: unknown = {}): Promise<string> {
    const id = await this.vectorStore.store(vector, metadata as Metadata);
    await this.index.add(id, vector);
    this.idToMetadata.set(id, metadata);
    return id;
  }

  /**
   * Remove a vector from both store and index
   */
  async removeVector(id: string): Promise<boolean> {
    await this.index.remove(id);
    this.idToMetadata.delete(id);
    return await this.vectorStore.delete(id);
  }

  /**
   * Get index statistics
   */
  getIndexStats(): { indexSize: number; metadataSize: number } {
    return {
      indexSize: this.index.size(),
      metadataSize: this.idToMetadata.size
    };
  }
}

/**
 * Performance comparison utility
 */
export class VectorSearchBenchmark {
  static async compare(
    vectorStore: VectorStore,
    queryVector: number[],
    options: VectorSearchOptions
  ): Promise<{
    directSearch: { results: VectorResult[]; timeMs: number };
    indexedSearch: { results: VectorResult[]; timeMs: number };
    speedup: number;
  }> {
    // Direct search using VectorStore
    const directStart = Date.now();
    const directResults = await vectorStore.search(queryVector, options);
    const directTime = Date.now() - directStart;
    
    // Indexed search
    const indexedStore = new IndexedVectorStore(vectorStore);
    await indexedStore.buildIndex();
    
    const indexedStart = Date.now();
    const indexedResults = await indexedStore.searchWithIndex(queryVector, options);
    const indexedTime = Date.now() - indexedStart;
    
    return {
      directSearch: { results: directResults, timeMs: directTime },
      indexedSearch: { results: indexedResults, timeMs: indexedTime },
      speedup: directTime / indexedTime
    };
  }
}