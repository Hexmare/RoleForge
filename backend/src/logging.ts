import debug from 'debug';

export const NAMESPACES = {
  server: {
    main: 'roleforge:server',
    socket: 'roleforge:server:socket',
    regen: 'roleforge:server:regen'
  },
  services: {
    scene: 'roleforge:services:scene',
    lorebook: 'roleforge:services:lorebook',
    character: 'roleforge:services:character'
  },
  agents: {
    base: 'roleforge:agents:base',
    orchestrator: 'roleforge:agents:orchestrator',
    vectorization: 'roleforge:agents:vectorization',
    visual: 'roleforge:agents:visual',
    narrator: 'roleforge:agents:narrator',
    director: 'roleforge:agents:director',
    summarize: 'roleforge:agents:summarize'
  },
  vectorStore: {
    vectra: 'roleforge:vectorstore:vectra',
    factory: 'roleforge:vectorstore:factory'
  },
  llm: {
    client: 'roleforge:llm:client',
    custom: 'roleforge:llm:custom'
  },
  utils: {
    memory: 'roleforge:utils:memory',
    lore: 'roleforge:utils:lore',
    embedding: 'roleforge:utils:embedding'
  }
} as const;

export const createLogger = (namespace: string) => debug(namespace);
