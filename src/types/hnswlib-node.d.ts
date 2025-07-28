declare module 'hnswlib-node' {
  export interface SearchResult {
    neighbors: number[];
    distances: number[];
  }

  export class HierarchicalNSW {
    constructor(space: 'l2' | 'ip' | 'cosine', dimension: number);
    
    initIndex(maxElements: number, M?: number, efConstruction?: number, randomSeed?: number): void;
    
    addPoint(vector: number[], label: number): void;
    
    searchKnn(query: number[], k: number, filter?: (label: number) => boolean): SearchResult;
    
    getIdsList(): number[];
    
    getPoint(label: number): number[];
    
    markDeleted(label: number): void;
    
    unmarkDeleted(label: number): void;
    
    saveIndex(path: string): void;
    
    loadIndex(path: string, maxElements?: number): void;
    
    save(): Buffer;
    
    load(data: Buffer): void;
    
    getMaxElements(): number;
    
    getCurrentCount(): number;
    
    resizeIndex(newMaxElements: number): void;
    
    setEf(ef: number): void;
    
    getEf(): number;
  }
}