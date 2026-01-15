import { pipeline, env } from '@xenova/transformers';

env.localModelPath = './vector_models';
env.allowRemoteModels = true;
env.allowLocalModels = true;

async function test() {
  try {
    console.log('[TEST] Initializing embedding pipeline...');
    const embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2');
    
    console.log('[TEST] Pipeline initialized, running test embedding...');
    const result = await embeddingPipeline('hello world');
    
    console.log('[TEST] Result type:', result?.constructor?.name);
    console.log('[TEST] Result.data type:', result.data?.constructor?.name);
    
    // Let's see the actual structure
    console.log('[TEST] Result keys:', Object.keys(result));
    console.log('[TEST] Result.data is TypedArray:', ArrayBuffer.isView(result.data));
    
    if (ArrayBuffer.isView(result.data)) {
      console.log('[TEST] Result.data dimensions: length =', result.data.length);
      console.log('[TEST] Result.data first 10 values:', Array.from(result.data).slice(0, 10));
    }
    
    // Check if result is the vector itself
    console.log('[TEST] Result itself - is it a TypedArray?', ArrayBuffer.isView(result));
    if (ArrayBuffer.isView(result)) {
      console.log('[TEST] Result is TypedArray with length:', result.length);
      console.log('[TEST] First 10 values:', Array.from(result).slice(0, 10));
    }
  } catch (error) {
    console.error('[TEST] Error:', error);
  }
  process.exit(0);
}

test();
