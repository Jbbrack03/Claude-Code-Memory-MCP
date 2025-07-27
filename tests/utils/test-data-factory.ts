/**
 * Test data factory for creating deterministic test data
 */
export class TestDataFactory {
  private counter = 0;

  constructor(private seed: number = 42) {}

  /**
   * Create a deterministic vector of given dimension
   */
  createVector(dimension: number): number[] {
    const base = this.counter++;
    return Array(dimension).fill(0).map((_, i) => {
      // Simple deterministic formula that produces values between -1 and 1
      const value = Math.sin((base * dimension + i) * 0.1) * Math.cos((base + i) * 0.2);
      return Math.max(-1, Math.min(1, value));
    });
  }

  /**
   * Create a batch of deterministic vectors
   */
  createVectorBatch(count: number, dimension: number): Array<{ vector: number[]; metadata: Record<string, any> }> {
    return Array(count).fill(null).map((_, i) => ({
      vector: this.createVector(dimension),
      metadata: {
        id: `test_${i}`,
        index: i,
        timestamp: 1700000000000 + i * 1000, // Fixed base with 1 second increments
        category: `category_${i % 5}`,
        score: 50 + (i % 50) // Scores between 50-99
      }
    }));
  }

  /**
   * Create a deterministic timestamp
   */
  createTimestamp(offset: number = 0): number {
    return 1700000000000 + offset;
  }

  /**
   * Create deterministic metadata
   */
  createMetadata(index: number): Record<string, any> {
    return {
      id: `item_${index}`,
      name: `Test Item ${index}`,
      category: ['A', 'B', 'C', 'D'][index % 4],
      score: 50 + (index % 50),
      timestamp: this.createTimestamp(index * 1000),
      tags: [`tag_${index % 3}`, `tag_${index % 5}`],
      active: index % 2 === 0
    };
  }

  /**
   * Reset the counter for consistent test runs
   */
  reset(): void {
    this.counter = 0;
  }
}

/**
 * Create a seeded random number generator for cases where randomness is needed
 * but must be deterministic for tests
 */
export class SeededRandom {
  private seed: number;

  constructor(seed: number = 42) {
    this.seed = seed;
  }

  /**
   * Generate a pseudo-random number between 0 and 1
   * Using a simple linear congruential generator
   */
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 2147483648;
    return this.seed / 2147483648;
  }

  /**
   * Generate a pseudo-random number between min and max
   */
  between(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Reset seed to initial value
   */
  reset(seed?: number): void {
    this.seed = seed ?? 42;
  }
}