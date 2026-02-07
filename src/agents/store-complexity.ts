// ============================================================================
// Agent: Store Complexity Analyzer (Generic — supports multiple store types)
// Analyzes state management modules for complexity and migration status
// ============================================================================

import { basename, dirname, join } from 'node:path';
import type { Agent, InspectorStore, StoreModule } from '../types.js';
import { readFileSafe, isTestFile } from '../utils/fs-utils.js';
import { analyzeVuexStore } from '../utils/ast.js';

export const storeComplexityAnalyzer: Agent = {
  name: 'Store Complexity Analyzer',
  description: 'Analyzes state management modules for complexity and migration status (auto-detected)',

  async run(store: InspectorStore): Promise<void> {
    const stateManagers = store.config?.stateManagement || [];

    if (stateManagers.length === 0) {
      console.log('  🏪 No state management detected — skipping');
      return;
    }

    console.log(`  🏪 Analyzing ${stateManagers.length} state management system(s)...`);

    for (const sm of stateManagers) {
      console.log(`      Analyzing ${sm.type} in ${sm.storeDir}...`);

      // ── Find all store files ──
      const storeFiles: string[] = [];
      for (const [rel] of store.files) {
        if (rel.startsWith(sm.storeDir + '/') && !isTestFile(rel)) {
          storeFiles.push(rel);
        }
      }

      // ── Build consumer map (who imports what store) ──
      const storeConsumers = new Map<string, Set<string>>();
      for (const edge of store.importGraph) {
        if (edge.target.startsWith(sm.storeDir + '/')) {
          if (!storeConsumers.has(edge.target)) storeConsumers.set(edge.target, new Set());
          storeConsumers.get(edge.target)!.add(edge.source);
        }
      }

      // ── Analyze each store module based on type ──
      if (sm.type === 'vuex') {
        analyzeVuexStores(storeFiles, sm.storeDir, sm.type, storeConsumers, store);
      } else if (sm.type === 'redux') {
        analyzeGenericStores(storeFiles, sm.storeDir, sm.type, storeConsumers, store);
      } else if (sm.type === 'zustand' || sm.type === 'pinia' || sm.type === 'mobx') {
        analyzeGenericStores(storeFiles, sm.storeDir, sm.type, storeConsumers, store);
      } else {
        analyzeGenericStores(storeFiles, sm.storeDir, sm.type, storeConsumers, store);
      }
    }

    // ── Check for migration between store types ──
    // e.g., Vuex store migrated to Zustand
    const storeTypes = new Set(stateManagers.map(s => s.type));
    if (storeTypes.size > 1) {
      console.log(`      Multiple store types detected: ${[...storeTypes].join(', ')} — checking for migrations`);
      // Try to match store modules by name across different store systems
      const modulesByName = new Map<string, StoreModule[]>();
      for (const mod of store.storeModules) {
        if (!modulesByName.has(mod.name)) modulesByName.set(mod.name, []);
        modulesByName.get(mod.name)!.push(mod);
      }
      for (const [, modules] of modulesByName) {
        if (modules.length > 1) {
          // Mark the older one as migrated to the newer one
          const sorted = modules.sort((a, b) => {
            const priority = ['vuex', 'redux', 'mobx', 'pinia', 'zustand'];
            return priority.indexOf(a.storeType) - priority.indexOf(b.storeType);
          });
          if (sorted.length >= 2) {
            sorted[0].migratedTo = sorted[sorted.length - 1].file;
          }
        }
      }
    }

    // Sort by complexity
    store.storeModules.sort((a, b) =>
      (b.actionCount + b.mutationCount + b.getterCount) -
      (a.actionCount + a.mutationCount + a.getterCount)
    );

    const totalMembers = store.storeModules.reduce((sum, m) => sum + m.actionCount + m.mutationCount + m.getterCount, 0);
    const godStores = store.storeModules.filter(m => m.actionCount + m.mutationCount + m.getterCount > 30);
    const migrated = store.storeModules.filter(m => m.migratedTo !== null);

    console.log(`  🏪 Analyzed ${store.storeModules.length} store modules`);
    console.log(`      Total members: ${totalMembers}`);
    console.log(`      God stores (>30 members): ${godStores.length}`);
    console.log(`      Migrated: ${migrated.length}`);
  },
};

function analyzeVuexStores(
  storeFiles: string[],
  storeDir: string,
  storeType: string,
  consumers: Map<string, Set<string>>,
  store: InspectorStore
): void {
  for (const storeFile of storeFiles) {
    if (!storeFile.endsWith('/index.js') && !storeFile.endsWith('/index.ts')) continue;

    const moduleName = basename(dirname(storeFile));
    const content = readFileSafe(join(store.rootDir, storeFile));
    if (!content) continue;

    const analysis = analyzeVuexStore(content);

    const specFile = storeFile.replace('/index.js', `/${moduleName}.spec.js`);
    const hasTests = store.files.has(specFile);

    const moduleConsumers = consumers.get(storeFile)
      ? [...consumers.get(storeFile)!]
      : [];

    store.storeModules.push({
      name: moduleName,
      file: storeFile,
      storeType,
      actionCount: analysis.actions.length,
      mutationCount: analysis.mutations.length,
      getterCount: analysis.getters.length,
      stateFields: analysis.stateFields.length,
      consumers: moduleConsumers,
      hasTests,
      migratedTo: null,
    });
  }
}

function analyzeGenericStores(
  storeFiles: string[],
  storeDir: string,
  storeType: string,
  consumers: Map<string, Set<string>>,
  store: InspectorStore
): void {
  for (const storeFile of storeFiles) {
    // Include any .ts/.tsx/.js/.jsx files (not just index files)
    if (!storeFile.endsWith('.ts') && !storeFile.endsWith('.tsx') &&
        !storeFile.endsWith('.js') && !storeFile.endsWith('.jsx')) continue;

    const fileName = basename(storeFile).replace(/\.[^.]+$/, '');
    if (fileName === 'index' || fileName === 'types' || fileName === 'constants') continue;

    const content = readFileSafe(join(store.rootDir, storeFile));
    if (!content) continue;

    // Count exports as a proxy for store complexity
    const exportMatches = content.match(/export\s+(?:const|function|class|default)/g);
    const memberCount = exportMatches ? exportMatches.length : 0;

    // Count function declarations for action-like detection
    const functionMatches = content.match(/(?:function|=>)\s*/g);
    const fnCount = functionMatches ? functionMatches.length : 0;

    const specFile = storeFile.replace(/\.[^.]+$/, '.spec' + storeFile.slice(storeFile.lastIndexOf('.')));
    const testFile = storeFile.replace(/\.[^.]+$/, '.test' + storeFile.slice(storeFile.lastIndexOf('.')));
    const hasTests = store.files.has(specFile) || store.files.has(testFile);

    const moduleConsumers = consumers.get(storeFile)
      ? [...consumers.get(storeFile)!]
      : [];

    store.storeModules.push({
      name: fileName,
      file: storeFile,
      storeType,
      actionCount: fnCount,
      mutationCount: 0,
      getterCount: memberCount,
      stateFields: 0,
      consumers: moduleConsumers,
      hasTests,
      migratedTo: null,
    });
  }
}
