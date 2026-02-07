// ============================================================================
// Agent: Migration Tracker (Generic — auto-detects migration direction)
// Tracks framework migration progress across the codebase
// ============================================================================

import { join, basename, dirname } from 'node:path';
import type { Agent, InspectorStore, MigrationEntry } from '../types.js';
import { readFileSafe } from '../utils/fs-utils.js';
import { extractFeatureFlags } from '../utils/ast.js';

export const migrationTracker: Agent = {
  name: 'Migration Tracker',
  description: 'Tracks framework migration progress across the codebase (auto-detected)',

  async run(store: InspectorStore): Promise<void> {
    const migration = store.config?.migration;
    if (!migration || !migration.detected) {
      console.log('  🔄 No migration detected — skipping');
      return;
    }

    console.log(`  🔄 Tracking ${migration.from} → ${migration.to} migration...`);

    const sourceExtensions = new Set(migration.sourceExtensions);
    const targetExtensions = new Set(migration.targetExtensions);
    const sourcePackages = new Set(migration.sourcePackages);
    const targetPackages = new Set(migration.targetPackages);

    // ── Find all source-framework components ──
    const sourceComponents = new Map<string, string[]>(); // folder → files
    for (const [rel, fileNode] of store.files) {
      const ext = fileNode.extension;
      if (!sourceExtensions.has(ext)) continue;

      // Only from source packages
      const inSourcePkg = [...sourcePackages].some(pkg => rel.startsWith(pkg + '/'));
      if (!inSourcePkg) continue;

      // Skip convention paths (pages, layouts, etc.)
      const isConvention = (store.config?.conventionPaths || []).some(cp => rel.startsWith(cp));
      if (isConvention) continue;

      const folder = dirname(rel);
      if (!sourceComponents.has(folder)) sourceComponents.set(folder, []);
      sourceComponents.get(folder)!.push(rel);
    }

    // ── Find all target-framework components ──
    const targetComponents = new Map<string, string[]>(); // folder → files
    for (const [rel, fileNode] of store.files) {
      const ext = fileNode.extension;
      if (!targetExtensions.has(ext)) continue;

      // Only from target packages
      const inTargetPkg = [...targetPackages].some(pkg => rel.startsWith(pkg + '/'));
      if (!inTargetPkg) continue;

      const folder = dirname(rel);
      if (!targetComponents.has(folder)) targetComponents.set(folder, []);
      targetComponents.get(folder)!.push(rel);
    }

    // ── Match source → target by component/folder name ──
    for (const [sourceFolder, sourceFiles] of sourceComponents) {
      let matchedTargetFolder: string | null = null;
      let featureFlag: string | null = null;

      // Heuristic: match by folder name
      const folderName = basename(sourceFolder);
      for (const [targetFolder] of targetComponents) {
        if (basename(targetFolder) === folderName || targetFolder.includes(`/${folderName}/`) || targetFolder.endsWith(`/${folderName}`)) {
          matchedTargetFolder = targetFolder;
          break;
        }
      }

      // Also try matching by parent folder name
      if (!matchedTargetFolder) {
        const parentName = basename(dirname(sourceFolder));
        if (parentName && parentName !== '.') {
          for (const [targetFolder] of targetComponents) {
            if (basename(targetFolder) === parentName || targetFolder.endsWith(`/${parentName}`)) {
              matchedTargetFolder = targetFolder;
              break;
            }
          }
        }
      }

      // Check for feature flags in source files
      for (const sourceFile of sourceFiles) {
        const content = readFileSafe(join(store.rootDir, sourceFile));
        const flags = extractFeatureFlags(content);
        if (flags.length > 0) {
          featureFlag = flags[0].flag;
        }
      }

      // Find bridge events
      const bridgeEvents: string[] = [];
      for (const sourceFile of sourceFiles) {
        const content = readFileSafe(join(store.rootDir, sourceFile));
        const eventMatches = content.match(/\.on\(\s*['"]([^'"]+)['"]/g);
        if (eventMatches) {
          bridgeEvents.push(...eventMatches.map(m => {
            const match = m.match(/['"]([^'"]+)['"]/);
            return match ? match[1] : '';
          }).filter(Boolean));
        }
      }

      // Determine status
      let status: MigrationEntry['status'] = 'unmigrated';
      if (matchedTargetFolder && targetComponents.has(matchedTargetFolder)) {
        if (featureFlag) {
          status = 'feature-flagged';
        } else if (bridgeEvents.length > 0) {
          status = 'partial';
        } else {
          status = 'migrated';
        }
      } else if (matchedTargetFolder) {
        status = 'partial';
      }

      for (const sourceFile of sourceFiles) {
        store.migrationEntries.push({
          sourceComponent: sourceFile,
          targetComponent: matchedTargetFolder ? `${matchedTargetFolder}/` : null,
          featureFlag,
          bridgeEvents: [...new Set(bridgeEvents)],
          status,
        });
      }
    }

    // ── Summary ──
    const statusCounts = {
      migrated: store.migrationEntries.filter(e => e.status === 'migrated').length,
      'feature-flagged': store.migrationEntries.filter(e => e.status === 'feature-flagged').length,
      partial: store.migrationEntries.filter(e => e.status === 'partial').length,
      unmigrated: store.migrationEntries.filter(e => e.status === 'unmigrated').length,
    };

    const total = store.migrationEntries.length;
    const migrated = statusCounts.migrated + statusCounts['feature-flagged'];
    const pct = total > 0 ? ((migrated / total) * 100).toFixed(1) : '0';

    console.log(`  🔄 Migration status: ${pct}% (${migrated}/${total} components)`);
    console.log(`      ✅ Migrated: ${statusCounts.migrated}`);
    console.log(`      🚩 Feature-flagged: ${statusCounts['feature-flagged']}`);
    console.log(`      🔀 Partial: ${statusCounts.partial}`);
    console.log(`      ❌ Unmigrated: ${statusCounts.unmigrated}`);
  },
};
