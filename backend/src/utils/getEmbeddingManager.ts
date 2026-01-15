import EmbeddingManager from './embeddingManager';
import { ConfigManager } from '../configManager';

const cfg = new ConfigManager();
const vectorCfg = cfg.getVectorConfig();
const model = vectorCfg && vectorCfg.embeddingModel ? String(vectorCfg.embeddingModel) : undefined;
const provider = vectorCfg && vectorCfg.embeddingProvider ? String(vectorCfg.embeddingProvider) : 'transformers';

export default function getEmbeddingManager(): EmbeddingManager {
  return EmbeddingManager.getInstance(provider, model);
}
