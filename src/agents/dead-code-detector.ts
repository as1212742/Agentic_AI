// ============================================================================
// Agent: Dead Code Detector (Generic — uses auto-detected convention paths)
// Finds exports with zero importers, orphaned components, unused stores
// ============================================================================

import type { Agent, InspectorStore } from '../types.js';
import { isTestFile } from '../utils/fs-utils.js';

export const deadCodeDetector: Agent = {
  name: 'Dead Code Detector',
  description: 'Identifies unused exports, orphaned components, and dead code',

  async run(store: InspectorStore): Promise<void> {
    console.log('  💀 Detecting dead code...');

    const deadFiles: string[] = [];
    const conventionPaths = store.config?.conventionPaths || [];
    const storeManagement = store.config?.stateManagement || [];

    // Build common config file patterns
    const configPatterns = [
      'nuxt.config', 'vite.config', 'webpack.config', 'next.config',
      'angular.json', 'svelte.config', 'astro.config',
      'eslint', 'jest', 'tailwind', 'tsconfig', 'babel.config',
      'postcss.config', '.prettierrc', 'vitest.config',
    ];

    // ── Build import target set (all files that are imported by at least one other file) ──
    const importedFiles = new Set<string>();
    for (const edge of store.importGraph) {
      importedFiles.add(edge.target);
    }

    // ── Find files never imported (except entry points, tests, configs, convention paths) ──
    const entryPointSet = new Set(store.entryPoints);
    for (const [rel, fileNode] of store.files) {
      if (isTestFile(rel)) continue;
      if (fileNode.language === 'json' || fileNode.language === 'css') continue;
      if (entryPointSet.has(rel)) continue;

      // Skip convention paths (pages, layouts, plugins, middleware, etc.)
      const isConvention = conventionPaths.some(cp => rel.startsWith(cp));
      if (isConvention) continue;

      // Skip config files
      const isConfig = configPatterns.some(p => rel.includes(p));
      if (isConfig) continue;

      if (!importedFiles.has(rel)) {
        deadFiles.push(rel);
      }
    }

    // ── Find unused exported symbols ──
    const importedSymbols = new Set<string>();
    for (const edge of store.importGraph) {
      for (const spec of edge.specifiers) {
        importedSymbols.add(`${edge.target}:${spec}`);
      }
      if (edge.isDefault) {
        importedSymbols.add(`${edge.target}:default`);
      }
    }

    let unusedExportCount = 0;
    for (const symbol of store.symbols) {
      if (!symbol.isExported) continue;
      if (isTestFile(symbol.file)) continue;

      const key = symbol.isDefault ? `${symbol.file}:default` : `${symbol.file}:${symbol.name}`;

      if (!importedSymbols.has(key)) {
        unusedExportCount++;
      }
    }

    // ── Find orphaned framework-specific files (mixins, composables, etc.) ──
    const orphanedSpecial: string[] = [];
    const mixinDirs = conventionPaths.filter(p => p.includes('mixin') || p.includes('composable'));
    for (const [rel] of store.files) {
      const isInMixinDir = mixinDirs.some(d => rel.startsWith(d));
      if (isInMixinDir && !importedFiles.has(rel)) {
        orphanedSpecial.push(rel);
      }
    }

    // ── Find unused store modules ──
    const unusedStores: string[] = [];
    for (const sm of storeManagement) {
      for (const [rel] of store.files) {
        if (rel.startsWith(sm.storeDir + '/') && (rel.endsWith('/index.js') || rel.endsWith('/index.ts'))) {
          if (!importedFiles.has(rel)) {
            unusedStores.push(rel);
          }
        }
      }
    }

    store.deadCode = [...deadFiles, ...orphanedSpecial, ...unusedStores];

    console.log(`  💀 Found ${deadFiles.length} potentially dead files`);
    console.log(`      Unused exports: ${unusedExportCount}`);
    console.log(`      Orphaned mixins/composables: ${orphanedSpecial.length}`);
    console.log(`      Unused stores: ${unusedStores.length}`);
  }
};
