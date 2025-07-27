declare module "@xenova/transformers" {
  export interface PipelineOutput {
    data: Float32Array;
    dims: number[];
  }
  
  export interface PipelineOptions {
    pooling?: 'mean' | 'max' | 'cls';
    normalize?: boolean;
    device?: 'cpu' | 'gpu';
  }
  
  export type Pipeline = (
    text: string | string[],
    options?: PipelineOptions
  ) => Promise<PipelineOutput>;
  
  export function pipeline(
    task: 'feature-extraction',
    model: string,
    options?: { device?: 'cpu' | 'gpu' }
  ): Promise<Pipeline>;
}