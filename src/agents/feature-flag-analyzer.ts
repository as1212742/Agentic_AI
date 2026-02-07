// ============================================================================
// Agent: Feature Flag Analyzer (Generic — auto-detects flag system)
// Scans for feature flag references and maps their blast radius
// ============================================================================

import type { Agent, InspectorStore, FeatureFlagRef } from '../types.js';
import { readFileSafe } from '../utils/fs-utils.js';
import { extractFeatureFlags, extractVueScriptContent } from '../utils/ast.js';

export const featureFlagAnalyzer: Agent = {
  name: 'Feature Flag Analyzer',
  description: 'Indexes feature flag references and maps their blast radius (auto-detected)',

  async run(store: InspectorStore): Promise<void> {
    const flagSystem = store.config?.featureFlags;

    if (!flagSystem) {
      // Even without a known system, scan for generic flag patterns
      console.log('  🚩 No known flag system detected — scanning for generic patterns...');
    } else {
      console.log(`  🚩 Scanning for ${flagSystem.system} feature flags...`);
    }

    for (const [rel, fileNode] of store.files) {
      if (fileNode.language === 'json' || fileNode.language === 'css') continue;

      const content = readFileSafe(fileNode.path);
      const codeContent = fileNode.language === 'vue' ? extractVueScriptContent(content) : content;
      if (!codeContent) continue;

      const flags = extractFeatureFlags(codeContent);
      for (const flag of flags) {
        store.featureFlags.push({
          flag: flag.flag,
          file: rel,
          line: flag.line,
          context: flag.context
        });
      }
    }

    // Bail early if no flags found
    if (store.featureFlags.length === 0) {
      console.log('  🚩 No feature flags found — skipping');
      return;
    }

    // ── Group by flag name ──
    const flagGroups = new Map<string, FeatureFlagRef[]>();
    for (const ref of store.featureFlags) {
      if (!flagGroups.has(ref.flag)) flagGroups.set(ref.flag, []);
      flagGroups.get(ref.flag)!.push(ref);
    }

    // ── Identify high-impact flags ──
    const highImpactFlags = [...flagGroups.entries()]
      .filter(([, refs]) => refs.length > 3)
      .sort((a, b) => b[1].length - a[1].length);

    const systemLabel = flagSystem ? ` (${flagSystem.system})` : '';
    console.log(`  🚩 Found ${store.featureFlags.length} flag references${systemLabel} across ${flagGroups.size} unique flags`);
    if (highImpactFlags.length > 0) {
      console.log('      High-impact flags:');
      for (const [flag, refs] of highImpactFlags.slice(0, 10)) {
        console.log(`        ${flag}: ${refs.length} references`);
      }
    }
  }
};
