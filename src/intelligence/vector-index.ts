import { createLogger } from "../utils/logger.js";
import { HierarchicalNSW } from 'hnswlib-node';
import { promises as fs } from 'fs';
import path from 'path';

const logger = createLogger("VectorIndex");

/**
 * Metadata associated with a vector document
 */
export interface VectorMetadata {
  id: string;
  workspaceId: string;
  timestamp: Date;
  [key: string]: unknown;
}

/**
 * A document containing a vector and its metadata
 */
export interface VectorDocument {
  id: string;
  vector: number[];
  metadata: VectorMetadata;
}

/**
 * Options for searching vectors
 */
export interface SearchOptions {
  limit?: number;
  threshold?: number;
  filter?: Record<string, unknown>;
}

/**
 * Result from a vector search
 */
export interface SearchResult {
  document: VectorDocument;
  score: number;
}

/**
 * Advanced vector index interface for scalable similarity search
 */
export interface ScalableVectorIndex {
  /**
   * Add a single document to the index
   */
  add(document: VectorDocument): Promise<void>;

  /**
   * Add multiple documents to the index
   */
  addBatch(documents: VectorDocument[]): Promise<void>;

  /**
   * Search for similar documents
   */
  search(query: number[], options?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Remove a document from the index
   */
  remove(id: string): Promise<void>;

  /**
   * Clear all documents from the index
   */
  clear(): Promise<void>;

  /**
   * Get the number of documents in the index
   */
  size(): Promise<number>;

  /**
   * Check if the index contains a document
   */
  has(id: string): Promise<boolean>;

  /**
   * Get a document by ID
   */
  get(id: string): Promise<VectorDocument | null>;

  /**
   * Persist the index to storage
   */
  persist(): Promise<void>;

  /**
   * Load the index from storage
   */
  load(): Promise<void>;
}

/**
 * Simple vector index interface (existing)
 */
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
  // eslint-disable-next-line @typescript-eslint/require-await
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
  // eslint-disable-next-line @typescript-eslint/require-await
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
  // eslint-disable-next-line @typescript-eslint/require-await
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
      const aVal = a[i];
      const bVal = b[i];
      if (aVal === undefined || bVal === undefined) {
        throw new Error('Invalid vector: undefined values');
      }
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
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
 * Scalable vector index implementation for high-performance similarity search.
 * This implementation supports:
 * - Efficient indexing structures (HNSW, IVF, etc.)
 * - Persistence to disk
 * - Memory management
 * - Batch operations
 * - Metadata filtering
 */
interface SerializedMetadata {
  dimension: number;
  nextIndex: number;
  documents: Array<[string, VectorDocument]>;
  idToIndex: Array<[string, number]>;
  indexToId: Array<[number, string]>;
  deletedIds: string[];
}

export class ScalableVectorIndexImpl implements ScalableVectorIndex {
  private index?: HierarchicalNSW;
  private dimension?: number;
  private documents: Map<string, VectorDocument> = new Map();
  private idToIndex: Map<string, number> = new Map();
  private indexToId: Map<number, string> = new Map();
  private deletedIds: Set<string> = new Set();
  private nextIndex = 0;
  private dataPath = '/tmp/test-vector-index';
  private isPersisting = false;
  private maxMemoryBytes = 10 * 1024 * 1024; // 10MB limit
  private estimatedMemoryUsage = 0;

  // eslint-disable-next-line @typescript-eslint/require-await
  async add(document: VectorDocument): Promise<void> {
    // Validate vector
    if (!document.vector || document.vector.length === 0) {
      throw new Error('Vector cannot be empty');
    }
    
    for (const value of document.vector) {
      if (!Number.isFinite(value)) {
        throw new Error('Vector contains invalid values (NaN or Infinity)');
      }
    }

    // Initialize dimension on first add
    if (!this.dimension) {
      this.dimension = document.vector.length;
      this.index = new HierarchicalNSW('cosine', this.dimension);
      this.index.initIndex(100000); // Initialize with max 100k elements
    }

    // Validate dimension consistency
    if (document.vector.length !== this.dimension) {
      throw new Error(`Vector dimension mismatch. Expected ${this.dimension}, got ${document.vector.length}`);
    }

    // Handle update case - mark old as deleted
    if (this.documents.has(document.id)) {
      this.deletedIds.add(document.id);
    }

    // Add to HNSW index
    const idx = this.nextIndex++;
    
    if (!this.index) {
      throw new Error('Index not initialized');
    }
    
    // Check if we need to resize the index
    if (idx >= this.index.getMaxElements()) {
      this.index.resizeIndex(idx + 10000);
    }
    
    this.index.addPoint(document.vector, idx);

    // Update mappings
    this.idToIndex.set(document.id, idx);
    this.indexToId.set(idx, document.id);
    this.documents.set(document.id, document);
    this.deletedIds.delete(document.id);
  }

  async addBatch(documents: VectorDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    // Estimate memory usage for this batch
    let batchMemoryEstimate = 0;
    for (const doc of documents) {
      // Vector memory: 4 bytes per float * dimension
      batchMemoryEstimate += doc.vector.length * 4;
      // Metadata memory estimate
      batchMemoryEstimate += JSON.stringify(doc.metadata).length;
      // Overhead for maps and indices
      batchMemoryEstimate += 100;
    }

    if (this.estimatedMemoryUsage + batchMemoryEstimate > this.maxMemoryBytes) {
      throw new Error('Memory limit exceeded');
    }

    // Validate all documents first
    for (const doc of documents) {
      if (!doc.vector || doc.vector.length === 0) {
        throw new Error(`Vector cannot be empty for document ${doc.id}`);
      }
      
      for (const value of doc.vector) {
        if (!Number.isFinite(value)) {
          throw new Error(`Vector contains invalid values for document ${doc.id}`);
        }
      }

      if (this.dimension && doc.vector.length !== this.dimension) {
        throw new Error(`Vector dimension mismatch for document ${doc.id}`);
      }
    }

    // Add all documents
    for (const doc of documents) {
      await this.add(doc);
    }
    
    this.estimatedMemoryUsage += batchMemoryEstimate;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async search(query: number[], options?: SearchOptions): Promise<SearchResult[]> {
    // Validate query vector first
    if (!query || query.length === 0) {
      throw new Error('Query vector cannot be empty');
    }

    for (const value of query) {
      if (!Number.isFinite(value)) {
        throw new Error('Query vector contains invalid values');
      }
    }

    // Check empty index before dimension check
    if (!this.index || this.documents.size === 0) {
      // Still validate dimension if we have one
      if (this.dimension && query.length !== this.dimension) {
        throw new Error(`Query dimension mismatch. Expected ${this.dimension}, got ${query.length}`);
      }
      return [];
    }

    if (query.length !== this.dimension) {
      throw new Error(`Query dimension mismatch. Expected ${this.dimension}, got ${query.length}`);
    }

    // Perform search
    const limit = options?.limit || 10;
    const threshold = options?.threshold || 0;

    // Search for more results to account for deleted items
    const searchLimit = Math.min(limit * 3, this.documents.size);
    const results = this.index.searchKnn(query, searchLimit);

    const searchResults: SearchResult[] = [];
    
    for (let i = 0; i < results.neighbors.length; i++) {
      const idx = results.neighbors[i];
      const distance = results.distances[i];
      if (idx === undefined || distance === undefined) {
        continue;
      }
      const score = 1 - distance; // Convert distance to similarity
      
      const id = this.indexToId.get(idx);
      if (!id || this.deletedIds.has(id)) {
        continue;
      }

      const document = this.documents.get(id);
      if (!document) {
        continue;
      }

      // Apply threshold
      if (score < threshold) {
        continue;
      }

      // Apply filters
      if (options?.filter) {
        let matches = true;
        for (const [key, value] of Object.entries(options.filter)) {
          if (document.metadata[key] !== value) {
            matches = false;
            break;
          }
        }
        if (!matches) {
          continue;
        }
      }

      searchResults.push({ document, score });

      if (searchResults.length >= limit) {
        break;
      }
    }

    return searchResults;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async remove(id: string): Promise<void> {
    if (this.documents.has(id)) {
      this.deletedIds.add(id);
      this.documents.delete(id);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async clear(): Promise<void> {
    this.index = undefined;
    this.dimension = undefined;
    this.documents.clear();
    this.idToIndex.clear();
    this.indexToId.clear();
    this.deletedIds.clear();
    this.nextIndex = 0;
    this.estimatedMemoryUsage = 0;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async size(): Promise<number> {
    return this.documents.size;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async has(id: string): Promise<boolean> {
    return this.documents.has(id) && !this.deletedIds.has(id);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async get(id: string): Promise<VectorDocument | null> {
    if (this.deletedIds.has(id)) {
      return null;
    }
    return this.documents.get(id) || null;
  }

  async persist(): Promise<void> {
    if (this.isPersisting) {
      // Wait for existing persist to complete
      while (this.isPersisting) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return;
    }

    this.isPersisting = true;
    try {
      await fs.mkdir(this.dataPath, { recursive: true });

      // Save metadata
      const metadata = {
        dimension: this.dimension,
        nextIndex: this.nextIndex,
        documents: Array.from(this.documents.entries()),
        idToIndex: Array.from(this.idToIndex.entries()),
        indexToId: Array.from(this.indexToId.entries()),
        deletedIds: Array.from(this.deletedIds)
      };

      await fs.writeFile(
        path.join(this.dataPath, 'index.json'),
        JSON.stringify(metadata, null, 2)
      );

      // Save HNSW index
      if (this.index) {
        await fs.writeFile(
          path.join(this.dataPath, 'hnsw.bin'),
          this.index.save()
        );
      }
    } finally {
      this.isPersisting = false;
    }
  }

  async load(): Promise<void> {
    try {
      // Load metadata
      const metadataPath = path.join(this.dataPath, 'index.json');
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataContent) as SerializedMetadata;

      this.dimension = metadata.dimension;
      this.nextIndex = metadata.nextIndex;
      this.documents = new Map(metadata.documents.map(([k, v]) => [
        k,
        { ...v, metadata: { ...v.metadata, timestamp: new Date(v.metadata.timestamp) } }
      ]));
      this.idToIndex = new Map(metadata.idToIndex);
      this.indexToId = new Map(metadata.indexToId.map(([k, v]) => [Number(k), v]));
      this.deletedIds = new Set(metadata.deletedIds);

      // Load HNSW index
      if (this.dimension && this.documents.size > 0) {
        const hnswPath = path.join(this.dataPath, 'hnsw.bin');
        const hnswData = await fs.readFile(hnswPath);
        this.index = new HierarchicalNSW('cosine', this.dimension);
        this.index.initIndex(Math.max(100000, this.nextIndex + 10000));
        this.index.load(hnswData);
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Files don't exist, initialize empty
        return;
      }
      if (error instanceof SyntaxError) {
        throw new Error('Corrupted persistence files');
      }
      throw error;
    }
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
      throw new Error(`Unknown vector index type: ${type as string}`);
  }
}