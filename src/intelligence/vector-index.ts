import { createLogger } from "../utils/logger.js";

const logger = createLogger("VectorIndex");

export interface VectorIndex {
  add(id: string, vector: number[]): Promise<void>;
  search(query: number[], k: number): Promise<Array<{id: string; score: number}>>;
  remove(id: string): Promise<void>;
  size(): number;
}

/**
 * Simple in-memory vector index implementation using cosine similarity.
 * This is a lightweight alternative to the full VectorStore for cases where
 * only basic vector search is needed without persistence or metadata.
 * 
 * Future improvements could include:
 * - HNSW (Hierarchical Navigable Small World) for O(log n) search
 * - Product quantization for memory efficiency
 * - Inverted file index for large-scale search
 */
export class SimpleVectorIndex implements VectorIndex {
  private vectors: Map<string, number[]> = new Map();
  private dimension?: number;

  /**
   * Add a vector to the index
   * @param id Unique identifier for the vector
   * @param vector The vector to store
   */
  async add(id: string, vector: number[]): Promise<void> {
    // Validate dimension consistency
    if (this.dimension === undefined) {
      this.dimension = vector.length;
    } else if (vector.length !== this.dimension) {
      throw new Error(`Vector dimension mismatch. Expected ${this.dimension}, got ${vector.length}`);
    }

    // Validate vector values
    for (const value of vector) {
      if (!Number.isFinite(value)) {
        throw new Error("Vector contains invalid values (NaN or Infinity)");
      }
    }

    this.vectors.set(id, vector);
    logger.debug(`Added vector ${id} to index`);
  }

  /**
   * Search for k nearest neighbors using cosine similarity
   * @param query Query vector
   * @param k Number of results to return
   * @returns Array of results sorted by similarity (descending)
   */
  async search(query: number[], k: number): Promise<Array<{id: string; score: number}>> {
    if (this.vectors.size === 0) {
      return [];
    }

    // Validate query dimension
    if (this.dimension !== undefined && query.length !== this.dimension) {
      throw new Error(`Query dimension mismatch. Expected ${this.dimension}, got ${query.length}`);
    }

    const results: Array<{id: string; score: number}> = [];
    
    // Calculate similarity for each vector
    for (const [id, vector] of this.vectors.entries()) {
      const score = this.cosineSimilarity(query, vector);
      results.push({ id, score });
    }
    
    // Sort by score (descending) and return top k
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /**
   * Remove a vector from the index
   * @param id ID of the vector to remove
   */
  async remove(id: string): Promise<void> {
    const deleted = this.vectors.delete(id);
    if (deleted) {
      logger.debug(`Removed vector ${id} from index`);
    }
  }

  /**
   * Get the number of vectors in the index
   */
  size(): number {
    return this.vectors.size;
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param a First vector
   * @param b Second vector
   * @returns Similarity score between -1 and 1
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    
    // Handle zero vectors
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    // Clamp result to [-1, 1] to handle numerical precision issues
    const similarity = dotProduct / (normA * normB);
    return Math.max(-1, Math.min(1, similarity));
  }
}

/**
 * Factory function to create vector index instances
 * @param type Type of index to create (currently only 'simple' is supported)
 * @returns VectorIndex instance
 */
export function createVectorIndex(type: 'simple' = 'simple'): VectorIndex {
  switch (type) {
    case 'simple':
      return new SimpleVectorIndex();
    default:
      throw new Error(`Unknown vector index type: ${type}`);
  }
}