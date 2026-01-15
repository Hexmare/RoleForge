const { pipeline, env } = require('@xenova/transformers');

env.localModelPath = './vector_models';
env.allowRemoteModels = true;
env.allowLocalModels = true;

async function test() {
  try {
    console.log('[TEST] Initializing embedding pipeline...');
    const embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2');
    
    console.log('[TEST] Pipeline initialized, running test embedding...');
    const result = await embeddingPipeline('hello world');
    
    console.log('[TEST] Result structure:');
    console.log('  typeof result:', typeof result);
    console.log('  result.data exists:', !!result.data);
    console.log('  result.data is array:', Array.isArray(result.data));
    
    if (result.data) {
      console.log('  result.data length:', result.data.length);
      if (result.data[0]) {
        console.log('  result.data[0] is array:', Array.isArray(result.data[0]));
        console.log('  result.data[0] length:', result.data[0].length);
        console.log('  result.data[0] typeof:', typeof result.data[0]);
        console.log('  result.data[0] first 5 values:', result.data[0].slice(0, 5));
      }
    }
    
    // Now check what embedText would do
    const vectors = result.data;
    const vector = vectors[0];
    console.log('\n[TEST] What embedText returns:');
    console.log('  vector is array:', Array.isArray(vector));
    console.log('  vector length:', vector?.length);
    console.log('  vector typeof:', typeof vector);
    console.log('  vector first 5:', vector?.slice(0, 5));
  } catch (error) {
    console.error('[TEST] Error:', error);
  }
  process.exit(0);
}

test();
