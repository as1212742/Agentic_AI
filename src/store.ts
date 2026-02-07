// ============================================================================
// Project Inspector — Shared Store
// ============================================================================

import type { InspectorStore } from './types.js';

export function createStore(rootDir: string, skipGit = false): InspectorStore {
  return {
    rootDir,
    skipGit,
    config: null,

    files: new Map(),
    importGraph: [],
    symbols: [],
    packages: [],
    entryPoints: [],

    features: [],

    fileMetrics: new Map(),
    featureScores: [],
    duplications: [],
    impactNodes: [],
    gitChurns: new Map(),

    migrationEntries: [],
    bridgeConnections: [],
    storeModules: [],
    featureFlags: [],
    configDiffs: [],
    deadCode: []
  };
}
