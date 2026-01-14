/**
 * Vector Store Factory - Creates and manages vector store instances
 * Allows easy provider swapping (Vectra, Qdrant, Milvus, etc.)
 */

import { VectorStoreInterface, VectorStoreProvider } from '../interfaces/VectorStoreInterface.js';
import VectraVectorStore from '../stores/VectraVectorStore.js';

class VectorStoreFactory {
  private static instances: Map<string, VectorStoreInterface> = new Map();

  /**
   * Create or get a vector store instance
   * 
   * @param provider - Type of vector store ('vectra', 'qdrant', 'milvus', etc.)
   * @param config - Provider-specific configuration
   * @returns Vector store instance implementing VectorStoreInterface
   */
  static createVectorStore(
    provider: VectorStoreProvider = 'vectra',
    config?: Record<string, any>
  ): VectorStoreInterface {
    const key = `${provider}:${JSON.stringify(config || {})}`;

    // Return cached instance if available
    if (this.instances.has(key)) {
      return this.instances.get(key)!;
    }

    let store: VectorStoreInterface;

    switch (provider.toLowerCase()) {
      case 'vectra':
        store = new VectraVectorStore(config?.basePath || './vector_data');
        break;

      // Future providers can be added here
      // case 'qdrant':
      //   store = new QdrantVectorStore(config);
      //   break;
      // case 'milvus':
      //   store = new MilvusVectorStore(config);
      //   break;

      default:
        throw new Error(`Unknown vector store provider: ${provider}`);
    }

    this.instances.set(key, store);
    console.log(`[VECTOR_STORE] Created ${provider} instance`);

    return store;
  }

  /**
   * Get a cached vector store instance
   */
  static getVectorStore(
    provider: VectorStoreProvider = 'vectra',
    config?: Record<string, any>
  ): VectorStoreInterface | null {
    const key = `${provider}:${JSON.stringify(config || {})}`;
    return this.instances.get(key) || null;
  }

  /**
   * Clear all cached instances
   */
  static clearCache(): void {
    this.instances.clear();
    console.log('[VECTOR_STORE] Cleared all cached instances');
  }

  /**
   * Get list of available providers
   */
  static getAvailableProviders(): string[] {
    return ['vectra', 'qdrant', 'milvus']; // Update as providers are added
  }
}

export default VectorStoreFactory;
export { VectorStoreFactory };
