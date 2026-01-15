import EmbeddingManager from './embeddingManager';
import { ConfigManager } from '../configManager';

const cfg = new ConfigManager();
const vectorCfg = cfg.getVectorConfig();
const model = vectorCfg && vectorCfg.embeddingModel ? String(vectorCfg.embeddingModel) : undefined;

export default function getEmbeddingManager(): typeof EmbeddingManager {
  return EmbeddingManager.getInstance(model);
}
