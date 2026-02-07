// ============================================================================
// Agent: Impact Analyzer
// Detects high blast-radius (fragile) zones
// ============================================================================

import type { Agent, InspectorStore, ImpactNode } from '../types.js';
import { isTestFile } from '../utils/fs-utils.js';

export const impactAnalyzer: Agent = {
  name: 'Impact Analyzer',
  description: 'Identifies high blast-radius components and fragile zones',

  async run(store: InspectorStore): Promise<void> {
    console.log('  💥 Analyzing impact zones...');

    // Build fan-in map
    const fanInMap = new Map<string, Set<string>>();
    for (const edge of store.importGraph) {
      if (!fanInMap.has(edge.target)) fanInMap.set(edge.target, new Set());
      fanInMap.get(edge.target)!.add(edge.source);
    }

    // Build file-to-feature map
    const fileToFeatures = new Map<string, Set<string>>();
    for (const feature of store.features) {
      for (const file of feature.files) {
        if (!fileToFeatures.has(file)) fileToFeatures.set(file, new Set());
        fileToFeatures.get(file)!.add(feature.id);
      }
    }

    // Check for test files
    const testFiles = new Set<string>();
    for (const [rel] of store.files) {
      if (isTestFile(rel)) testFiles.add(rel);
    }

    // Compute which source files have tests
    const filesWithTests = new Set<string>();
    for (const testFile of testFiles) {
      // Test file → source file mapping (heuristic: same name without .spec/.test)
      const sourceFile = testFile
        .replace('.spec.', '.')
        .replace('.test.', '.');
      if (store.files.has(sourceFile)) {
        filesWithTests.add(sourceFile);
      }
    }

    // Score each file
    for (const [rel, fileNode] of store.files) {
      if (isTestFile(rel)) continue;
      if (fileNode.language === 'json' || fileNode.language === 'css') continue;

      const fanIn = fanInMap.get(rel)?.size || 0;
      const featureCount = fileToFeatures.get(rel)?.size || 0;
      const gitChurn = store.gitChurns.get(rel)?.commitCount || 0;
      const hasTests = filesWithTests.has(rel);
      const metrics = store.fileMetrics.get(rel);
      const complexity = metrics?.cyclomaticComplexity || 0;

      // Impact score formula:
      // - Fan-in weight: 35% (more importers = higher blast radius)
      // - Multi-feature: 25% (used across features = wider impact)
      // - Git churn: 20% (frequently changed = more likely to break)
      // - Test absence: 10% (no tests = changes are riskier)
      // - Complexity: 10% (complex code is harder to change safely)
      const fanInScore = Math.min(fanIn / 30, 1) * 35;
      const featureScore = Math.min(featureCount / 5, 1) * 25;
      const churnScore = Math.min(gitChurn / 100, 1) * 20;
      const testScore = hasTests ? 0 : 10;
      const complexityScore = Math.min(complexity / 50, 1) * 10;

      const impactScore = Math.round(fanInScore + featureScore + churnScore + testScore + complexityScore);

      if (impactScore < 15) continue; // skip low-impact files

      const severity: ImpactNode['severity'] =
        impactScore >= 70 ? 'critical' :
        impactScore >= 50 ? 'high' :
        impactScore >= 30 ? 'medium' : 'low';

      store.impactNodes.push({
        file: rel,
        fanIn,
        featureCount,
        gitChurn,
        hasTests,
        impactScore,
        severity,
      });
    }

    // Sort by impact score descending
    store.impactNodes.sort((a, b) => b.impactScore - a.impactScore);

    const critical = store.impactNodes.filter(n => n.severity === 'critical').length;
    const high = store.impactNodes.filter(n => n.severity === 'high').length;
    console.log(`  💥 Found ${store.impactNodes.length} impact nodes (${critical} critical, ${high} high)`);
  },
};

