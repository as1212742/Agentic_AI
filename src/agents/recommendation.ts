// ============================================================================
// Agent: Recommendation Engine (Generic — dynamic labels from auto-detected config)
// Generates written reports, architecture diagrams, and feature agent specs
// ============================================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Agent, InspectorStore, Feature, FeatureScore, ImpactNode } from '../types.js';
import { generateDashboard } from './dashboard-generator.js';

export const recommendationAgent: Agent = {
  name: 'Recommendation Agent',
  description: 'Aggregates all analysis results into reports, diagrams, and feature agent specs',

  async run(store: InspectorStore): Promise<void> {
    const reportDir = join(store.rootDir, 'report');
    const featuresDir = join(reportDir, 'features');
    const agentsDir = join(reportDir, 'feature-agents');

    mkdirSync(reportDir, { recursive: true });
    mkdirSync(featuresDir, { recursive: true });
    mkdirSync(agentsDir, { recursive: true });

    console.log('  📝 Generating reports...');

    // ── 1. Global Index JSON ──
    writeJsonReport(join(reportDir, 'global_index.json'), {
      generated: new Date().toISOString(),
      autoDetectedConfig: store.config ? {
        monorepoTool: store.config.monorepoTool,
        packages: store.config.packages.map(p => ({ dir: p.dir, framework: p.framework, name: p.name })),
        migration: store.config.migration,
        featureFlags: store.config.featureFlags,
        stateManagement: store.config.stateManagement,
      } : null,
      summary: {
        totalFiles: store.files.size,
        totalImportEdges: store.importGraph.length,
        totalSymbols: store.symbols.length,
        totalFeatures: store.features.length,
        packages: store.packages.map(p => ({ name: p.name, framework: p.framework })),
      },
      entryPoints: store.entryPoints,
    });

    // ── 2. Feature Reports ──
    const scoreMap = new Map(store.featureScores.map(s => [s.featureId, s]));
    for (const feature of store.features) {
      if (feature.isCrossCutting) continue;
      const score = scoreMap.get(feature.id);
      const report = generateFeatureReport(feature, score, store);
      writeFileSync(join(featuresDir, `feature-${sanitizeFilename(feature.id)}.md`), report);
    }

    // ── 3. Duplication Report ──
    writeFileSync(join(reportDir, 'duplication.md'), generateDuplicationReport(store));

    // ── 4. Risk Map ──
    writeFileSync(join(reportDir, 'risk_map.md'), generateRiskMap(store));

    // ── 5. Dead Code Report ──
    writeFileSync(join(reportDir, 'dead_code.md'), generateDeadCodeReport(store));

    // ── 6. Bridge Health Report ──
    if (store.bridgeConnections.length > 0) {
      writeFileSync(join(reportDir, 'bridge_health.md'), generateBridgeHealthReport(store));
    }

    // ── 7. Config Drift Report ──
    if (store.configDiffs.length > 0) {
      writeFileSync(join(reportDir, 'config_drift.md'), generateConfigDriftReport(store));
    }

    // ── 8. Store Complexity Report ──
    if (store.storeModules.length > 0) {
      writeFileSync(join(reportDir, 'store_complexity.md'), generateStoreReport(store));
    }

    // ── 9. Migration Status Report ──
    if (store.migrationEntries.length > 0) {
      writeFileSync(join(reportDir, 'migration_status.md'), generateMigrationReport(store));
    }

    // ── 10. Recommendations ──
    writeFileSync(join(reportDir, 'recommendations.md'), generateRecommendations(store));

    // ── 11. Architecture Diagram (Mermaid) ──
    writeFileSync(join(reportDir, 'architecture.mmd'), generateArchitectureDiagram(store));

    // ── 12. Auto-generated Feature Agent Specs ──
    for (const feature of store.features) {
      if (feature.isCrossCutting) continue;
      if (feature.files.length < 3) continue;
      const agentSpec = generateAgentSpec(feature, scoreMap.get(feature.id), store);
      writeFileSync(join(agentsDir, `${sanitizeFilename(feature.id)}-AGENT.md`), agentSpec);
    }

    // ── 13. Interactive HTML Dashboard ──
    generateDashboard(store);

    console.log(`  📝 Reports written to ${reportDir}/`);
  },
};

// ─── Dynamic Labels ─────────────────────────────────────────────────────────

function getMigrationLabel(store: InspectorStore): string {
  const m = store.config?.migration;
  if (!m) return 'Migration';
  return `${capitalize(m.from)} → ${capitalize(m.to)} Migration`;
}

function getStoreLabel(store: InspectorStore): string {
  const types = new Set((store.config?.stateManagement || []).map(s => s.type));
  if (types.size === 0) return 'Store';
  return [...types].map(capitalize).join(' / ') + ' Store';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Report Generators ────────────────────────────────────────────────────

function generateFeatureReport(feature: Feature, score: FeatureScore | undefined, store: InspectorStore): string {
  const lines: string[] = [];
  lines.push(`# Feature: ${feature.name}`);
  lines.push('');
  lines.push(`> ${feature.description}`);
  lines.push('');

  if (score) {
    lines.push('## Scores');
    lines.push('');
    lines.push(`| Metric | Score | Grade |`);
    lines.push(`|--------|-------|-------|`);
    lines.push(`| Architecture | ${score.architecture}/10 | ${gradeEmoji(score.architecture)} |`);
    lines.push(`| Code Quality | ${score.codeQuality}/10 | ${gradeEmoji(score.codeQuality)} |`);
    lines.push(`| Bug Risk | ${score.bugRisk}/10 | ${gradeEmoji(score.bugRisk)} |`);
    lines.push(`| Test Coverage | ${score.testCoverage}/10 | ${gradeEmoji(score.testCoverage)} |`);
    if (store.config?.migration) {
      lines.push(`| ${getMigrationLabel(store)} Health | ${score.migrationHealth}/10 | ${gradeEmoji(score.migrationHealth)} |`);
    }
    lines.push(`| **Overall** | **${score.overall}/10** | **${score.grade}** |`);
    lines.push('');
  }

  lines.push('## Files');
  lines.push('');
  lines.push(`Total: ${feature.files.length} files`);
  lines.push('');
  const byExtension = new Map<string, number>();
  for (const f of feature.files) {
    const ext = f.split('.').pop() || 'other';
    byExtension.set(ext, (byExtension.get(ext) || 0) + 1);
  }
  for (const [ext, count] of byExtension) {
    lines.push(`- \`.${ext}\`: ${count} files`);
  }
  lines.push('');

  if (feature.entryPoints.length > 0) {
    lines.push('## Entry Points');
    lines.push('');
    for (const ep of feature.entryPoints) {
      lines.push(`- \`${ep}\``);
    }
    lines.push('');
  }

  const featureImpact = store.impactNodes.filter(n => feature.files.includes(n.file));
  if (featureImpact.length > 0) {
    lines.push('## High Impact Files');
    lines.push('');
    lines.push(`| File | Fan-In | Churn | Impact | Severity |`);
    lines.push(`|------|--------|-------|--------|----------|`);
    for (const node of featureImpact.slice(0, 10)) {
      lines.push(`| \`${node.file}\` | ${node.fanIn} | ${node.gitChurn} | ${node.impactScore} | ${node.severity} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateDuplicationReport(store: InspectorStore): string {
  const lines: string[] = [];
  lines.push('# Duplication Report');
  lines.push('');
  lines.push(`Found **${store.duplications.length}** duplication pairs.`);
  lines.push('');

  if (store.duplications.length > 0) {
    lines.push('## Top Duplication Pairs');
    lines.push('');
    lines.push(`| File A | File B | Lines |`);
    lines.push(`|--------|--------|-------|`);
    for (const dup of store.duplications.slice(0, 50)) {
      lines.push(`| \`${dup.fileA}\` | \`${dup.fileB}\` | ${dup.lineCount} |`);
    }
    lines.push('');

    lines.push('## Refactor Candidates');
    lines.push('');
    lines.push('Files appearing in multiple duplication pairs (extract shared module):');
    lines.push('');
    const fileCounts = new Map<string, number>();
    for (const dup of store.duplications) {
      fileCounts.set(dup.fileA, (fileCounts.get(dup.fileA) || 0) + 1);
      fileCounts.set(dup.fileB, (fileCounts.get(dup.fileB) || 0) + 1);
    }
    const sorted = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    for (const [file, count] of sorted) {
      lines.push(`- \`${file}\` — duplicated with ${count} other files`);
    }
  }

  return lines.join('\n');
}

function generateRiskMap(store: InspectorStore): string {
  const lines: string[] = [];
  lines.push('# Risk Map — Severe / Fragile Zones');
  lines.push('');

  const critical = store.impactNodes.filter(n => n.severity === 'critical');
  const high = store.impactNodes.filter(n => n.severity === 'high');

  lines.push(`| Severity | Count |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Critical | ${critical.length} |`);
  lines.push(`| High | ${high.length} |`);
  lines.push(`| Medium | ${store.impactNodes.filter(n => n.severity === 'medium').length} |`);
  lines.push(`| Low | ${store.impactNodes.filter(n => n.severity === 'low').length} |`);
  lines.push('');

  if (critical.length > 0) {
    lines.push('## Critical Zones');
    lines.push('');
    lines.push('These files have the highest blast radius — changes here affect the most code:');
    lines.push('');
    lines.push(`| File | Fan-In | Features | Churn | Tests | Score |`);
    lines.push(`|------|--------|----------|-------|-------|-------|`);
    for (const node of critical) {
      lines.push(`| \`${node.file}\` | ${node.fanIn} | ${node.featureCount} | ${node.gitChurn} | ${node.hasTests ? 'Yes' : '**No**'} | ${node.impactScore} |`);
    }
    lines.push('');
  }

  if (high.length > 0) {
    lines.push('## High-Risk Zones');
    lines.push('');
    lines.push(`| File | Fan-In | Features | Churn | Tests | Score |`);
    lines.push(`|------|--------|----------|-------|-------|-------|`);
    for (const node of high.slice(0, 30)) {
      lines.push(`| \`${node.file}\` | ${node.fanIn} | ${node.featureCount} | ${node.gitChurn} | ${node.hasTests ? 'Yes' : '**No**'} | ${node.impactScore} |`);
    }
  }

  return lines.join('\n');
}

function generateDeadCodeReport(store: InspectorStore): string {
  const lines: string[] = [];
  lines.push('# Dead Code Report');
  lines.push('');
  lines.push(`Found **${store.deadCode.length}** potentially dead files (not imported by any other file).`);
  lines.push('');

  const byPackage = new Map<string, string[]>();
  for (const file of store.deadCode) {
    const fileNode = store.files.get(file);
    const pkg = fileNode?.package || 'unknown';
    if (!byPackage.has(pkg)) byPackage.set(pkg, []);
    byPackage.get(pkg)!.push(file);
  }

  for (const [pkg, files] of byPackage) {
    lines.push(`## ${pkg} (${files.length} files)`);
    lines.push('');
    for (const file of files.slice(0, 30)) {
      lines.push(`- \`${file}\``);
    }
    if (files.length > 30) {
      lines.push(`- ... and ${files.length - 30} more`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateBridgeHealthReport(store: InspectorStore): string {
  const lines: string[] = [];
  const bridgeLabel = store.config?.migration
    ? `Bridge Health Report (${capitalize(store.config.migration.from)} ↔ ${capitalize(store.config.migration.to)})`
    : 'Bridge Health Report';
  lines.push(`# ${bridgeLabel}`);
  lines.push('');

  const healthy = store.bridgeConnections.filter(b => b.isHealthy);
  const unhealthy = store.bridgeConnections.filter(b => !b.isHealthy);

  lines.push(`| Status | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Healthy | ${healthy.length} |`);
  lines.push(`| Issues | ${unhealthy.length} |`);
  lines.push('');

  if (unhealthy.length > 0) {
    lines.push('## Issues');
    lines.push('');
    lines.push(`| Event | Emitter | Listener | Issue |`);
    lines.push(`|-------|---------|----------|-------|`);
    for (const conn of unhealthy) {
      lines.push(`| \`${conn.eventName}\` | \`${conn.emitterFile}:${conn.emitterLine}\` | \`${conn.listenerFile || '(none)'}:${conn.listenerLine || ''}\` | ${conn.issue} |`);
    }
    lines.push('');
  }

  if (healthy.length > 0) {
    lines.push('## Healthy Connections');
    lines.push('');
    lines.push(`| Event | Emitter | Listener | Unsubscribe |`);
    lines.push(`|-------|---------|----------|-------------|`);
    for (const conn of healthy.slice(0, 20)) {
      lines.push(`| \`${conn.eventName}\` | \`${conn.emitterFile}\` | \`${conn.listenerFile}\` | ${conn.hasUnsubscribe ? 'Yes' : 'No'} |`);
    }
  }

  return lines.join('\n');
}

function generateConfigDriftReport(store: InspectorStore): string {
  const lines: string[] = [];
  lines.push('# Configuration Drift Report');
  lines.push('');
  lines.push(`Found **${store.configDiffs.length}** configuration differences across packages.`);
  lines.push('');

  const byType = new Map<string, typeof store.configDiffs>();
  for (const diff of store.configDiffs) {
    if (!byType.has(diff.configType)) byType.set(diff.configType, []);
    byType.get(diff.configType)!.push(diff);
  }

  for (const [type, diffs] of byType) {
    lines.push(`## ${type}`);
    lines.push('');
    lines.push(`| Key | ${diffs[0]?.packageA} | ${diffs[0]?.packageB} |`);
    lines.push(`|-----|---|---|`);
    for (const diff of diffs.slice(0, 20)) {
      lines.push(`| \`${diff.key}\` | ${diff.valueA} | ${diff.valueB} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateStoreReport(store: InspectorStore): string {
  const lines: string[] = [];
  const storeLabel = getStoreLabel(store);
  lines.push(`# ${storeLabel} Complexity Report`);
  lines.push('');
  lines.push(`Analyzed **${store.storeModules.length}** store modules.`);
  lines.push('');

  lines.push('## Module Overview');
  lines.push('');
  lines.push(`| Module | Type | Actions | Mutations | Getters | State | Consumers | Tests | Migrated |`);
  lines.push(`|--------|------|---------|-----------|---------|-------|-----------|-------|----------|`);
  for (const mod of store.storeModules) {
    const total = mod.actionCount + mod.mutationCount + mod.getterCount;
    const risk = total > 30 ? ' ⚠️' : '';
    lines.push(`| \`${mod.name}\`${risk} | ${mod.storeType} | ${mod.actionCount} | ${mod.mutationCount} | ${mod.getterCount} | ${mod.stateFields} | ${mod.consumers.length} | ${mod.hasTests ? 'Yes' : '**No**'} | ${mod.migratedTo ? 'Yes' : 'No'} |`);
  }
  lines.push('');

  const godStores = store.storeModules.filter(m => m.actionCount + m.mutationCount + m.getterCount > 30);
  if (godStores.length > 0) {
    lines.push('## God Stores (>30 members) — Refactor Candidates');
    lines.push('');
    for (const mod of godStores) {
      lines.push(`### \`${mod.name}\` (${mod.storeType})`);
      lines.push(`- ${mod.actionCount} actions, ${mod.mutationCount} mutations, ${mod.getterCount} getters`);
      lines.push(`- ${mod.consumers.length} consumer files`);
      lines.push(`- Recommendation: Split into domain-specific sub-modules`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function generateMigrationReport(store: InspectorStore): string {
  const lines: string[] = [];
  const migLabel = getMigrationLabel(store);
  lines.push(`# ${migLabel} Status`);
  lines.push('');

  const total = store.migrationEntries.length;
  const migrated = store.migrationEntries.filter(e => e.status === 'migrated').length;
  const flagged = store.migrationEntries.filter(e => e.status === 'feature-flagged').length;
  const partial = store.migrationEntries.filter(e => e.status === 'partial').length;
  const unmigrated = store.migrationEntries.filter(e => e.status === 'unmigrated').length;
  const pct = total > 0 ? (((migrated + flagged) / total) * 100).toFixed(1) : '0';

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Status | Count | % |`);
  lines.push(`|--------|-------|---|`);
  lines.push(`| Migrated | ${migrated} | ${total > 0 ? ((migrated / total) * 100).toFixed(1) : 0}% |`);
  lines.push(`| Feature-Flagged | ${flagged} | ${total > 0 ? ((flagged / total) * 100).toFixed(1) : 0}% |`);
  lines.push(`| Partial (Bridge Active) | ${partial} | ${total > 0 ? ((partial / total) * 100).toFixed(1) : 0}% |`);
  lines.push(`| Unmigrated | ${unmigrated} | ${total > 0 ? ((unmigrated / total) * 100).toFixed(1) : 0}% |`);
  lines.push(`| **Total** | **${total}** | **${pct}% done** |`);
  lines.push('');

  lines.push('```mermaid');
  lines.push('pie title Migration Progress');
  lines.push(`    "Migrated" : ${migrated}`);
  lines.push(`    "Feature-Flagged" : ${flagged}`);
  lines.push(`    "Partial" : ${partial}`);
  lines.push(`    "Unmigrated" : ${unmigrated}`);
  lines.push('```');
  lines.push('');

  const activeEvents = new Set<string>();
  for (const entry of store.migrationEntries) {
    for (const event of entry.bridgeEvents) {
      activeEvents.add(event);
    }
  }

  if (activeEvents.size > 0) {
    lines.push('## Active Bridge Events');
    lines.push('');
    lines.push('These events are still used for cross-framework communication:');
    lines.push('');
    for (const event of activeEvents) {
      lines.push(`- \`${event}\``);
    }
    lines.push('');
  }

  if (unmigrated > 0) {
    lines.push('## Unmigrated Components');
    lines.push('');
    const unmig = store.migrationEntries.filter(e => e.status === 'unmigrated');
    for (const entry of unmig.slice(0, 30)) {
      lines.push(`- \`${entry.sourceComponent}\``);
    }
    if (unmig.length > 30) {
      lines.push(`- ... and ${unmig.length - 30} more`);
    }
  }

  return lines.join('\n');
}

function generateRecommendations(store: InspectorStore): string {
  const lines: string[] = [];
  lines.push('# Recommendations');
  lines.push('');

  const critical = store.impactNodes.filter(n => n.severity === 'critical');
  if (critical.length > 0) {
    lines.push('## P0 — Critical Blast Radius Zones');
    lines.push('');
    lines.push('These files must be stabilized first. A change here can break multiple features:');
    lines.push('');
    for (const node of critical.slice(0, 10)) {
      lines.push(`### \`${node.file}\``);
      lines.push(`- Fan-in: ${node.fanIn} files depend on this`);
      lines.push(`- Used in ${node.featureCount} features`);
      lines.push(`- Git churn: ${node.gitChurn} commits`);
      lines.push(`- Has tests: ${node.hasTests ? 'Yes' : '**No — add tests immediately**'}`);
      lines.push(`- **Action**: ${!node.hasTests ? 'Add unit tests. ' : ''}Consider extracting a stable API surface.`);
      lines.push('');
    }
  }

  const unhealthyBridges = store.bridgeConnections.filter(b => !b.isHealthy);
  if (unhealthyBridges.length > 0) {
    lines.push('## P1 — Fix Event Bridge Issues');
    lines.push('');
    lines.push(`${unhealthyBridges.length} bridge connections have issues that may cause memory leaks or silent failures.`);
    lines.push('');
    for (const conn of unhealthyBridges.slice(0, 10)) {
      lines.push(`- **${conn.eventName}**: ${conn.issue}`);
      lines.push(`  - Emitter: \`${conn.emitterFile}\``);
      lines.push(`  - Listener: \`${conn.listenerFile || 'none'}\``);
      lines.push('');
    }
  }

  const godStores = store.storeModules.filter(m => m.actionCount + m.mutationCount + m.getterCount > 30);
  if (godStores.length > 0) {
    lines.push('## P2 — Decompose God Stores');
    lines.push('');
    for (const mod of godStores) {
      lines.push(`### \`${mod.name}\` store (${mod.storeType})`);
      lines.push(`- ${mod.actionCount + mod.mutationCount + mod.getterCount} total members`);
      lines.push(`- **Action**: Split into domain-specific sub-modules.`);
      lines.push('');
    }
  }

  const unmigrated = store.migrationEntries.filter(e => e.status === 'unmigrated');
  if (unmigrated.length > 0) {
    lines.push(`## P3 — ${getMigrationLabel(store)} Acceleration`);
    lines.push('');
    lines.push(`${unmigrated.length} components still need migration.`);
    lines.push('');
    lines.push('Suggested migration order (by feature impact):');
    lines.push('');
    const featureUnmigrated = new Map<string, number>();
    for (const entry of unmigrated) {
      const feature = store.features.find(f => f.files.includes(entry.sourceComponent));
      const featureName = feature?.name || 'Unknown';
      featureUnmigrated.set(featureName, (featureUnmigrated.get(featureName) || 0) + 1);
    }
    const sorted = [...featureUnmigrated.entries()].sort((a, b) => b[1] - a[1]);
    for (const [feature, count] of sorted.slice(0, 15)) {
      lines.push(`1. **${feature}** — ${count} components remaining`);
    }
    lines.push('');
  }

  if (store.configDiffs.length > 0) {
    lines.push('## P4 — Resolve Configuration Drift');
    lines.push('');
    lines.push(`${store.configDiffs.length} configuration differences detected. Align package configs to prevent build inconsistencies.`);
    lines.push('');
  }

  if (store.deadCode.length > 0) {
    lines.push('## P5 — Clean Up Dead Code');
    lines.push('');
    lines.push(`${store.deadCode.length} files appear to be dead code (not imported anywhere).`);
    lines.push('');
    lines.push('**Action**: Audit and remove unused files to reduce maintenance burden.');
    lines.push('');
  }

  return lines.join('\n');
}

function generateArchitectureDiagram(store: InspectorStore): string {
  const lines: string[] = [];
  lines.push('graph TD');
  lines.push('');

  for (const pkg of store.packages) {
    const id = sanitizeMermaidId(pkg.relativePath);
    lines.push(`    ${id}["${pkg.name}<br/>${pkg.framework}"]`);
  }
  lines.push('');

  const pkgEdges = new Set<string>();
  for (const edge of store.importGraph) {
    const srcFile = store.files.get(edge.source);
    const tgtFile = store.files.get(edge.target);
    if (srcFile && tgtFile && srcFile.package !== tgtFile.package) {
      const edgeKey = `${srcFile.package}|${tgtFile.package}`;
      if (!pkgEdges.has(edgeKey)) {
        pkgEdges.add(edgeKey);
        lines.push(`    ${sanitizeMermaidId(srcFile.package)} --> ${sanitizeMermaidId(tgtFile.package)}`);
      }
    }
  }
  lines.push('');

  lines.push('    subgraph Features');
  const topFeatures = store.features
    .filter(f => !f.isCrossCutting)
    .sort((a, b) => b.files.length - a.files.length)
    .slice(0, 15);

  for (const feature of topFeatures) {
    const id = sanitizeMermaidId(feature.id);
    const score = store.featureScores.find(s => s.featureId === feature.id);
    const grade = score ? ` [${score.grade}]` : '';
    lines.push(`        ${id}["${feature.name}${grade}<br/>${feature.files.length} files"]`);
  }
  lines.push('    end');

  return lines.join('\n');
}

function generateAgentSpec(feature: Feature, score: FeatureScore | undefined, store: InspectorStore): string {
  const lines: string[] = [];
  lines.push(`# ${feature.name} Feature Agent`);
  lines.push('');
  lines.push(`> **Auto-generated** by Project Inspector on ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## Feature Scope');
  lines.push('');
  lines.push(`| Property | Value |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Files | ${feature.files.length} |`);
  lines.push(`| Entry Points | ${feature.entryPoints.length} |`);
  lines.push(`| Confidence | ${(feature.confidence * 100).toFixed(0)}% |`);
  if (score) {
    lines.push(`| Overall Score | ${score.overall}/10 (${score.grade}) |`);
  }
  lines.push('');

  if (feature.entryPoints.length > 0) {
    lines.push('## Entry Points');
    lines.push('');
    for (const ep of feature.entryPoints) {
      lines.push(`- \`${ep}\``);
    }
    lines.push('');
  }

  lines.push('## Key Files');
  lines.push('');
  const filesByImportance = feature.files
    .map(f => ({ file: f, metrics: store.fileMetrics.get(f) }))
    .filter(f => f.metrics)
    .sort((a, b) => (b.metrics!.fanIn + b.metrics!.fanOut) - (a.metrics!.fanIn + a.metrics!.fanOut))
    .slice(0, 15);

  lines.push(`| File | LOC | Complexity | Fan-In | Fan-Out |`);
  lines.push(`|------|-----|-----------|--------|---------|`);
  for (const { file, metrics } of filesByImportance) {
    lines.push(`| \`${file}\` | ${metrics!.loc} | ${metrics!.cyclomaticComplexity} | ${metrics!.fanIn} | ${metrics!.fanOut} |`);
  }
  lines.push('');

  const impactNodes = store.impactNodes.filter(n => feature.files.includes(n.file));
  if (impactNodes.length > 0) {
    lines.push('## High Impact / Fragile Files');
    lines.push('');
    for (const node of impactNodes.slice(0, 5)) {
      lines.push(`- \`${node.file}\` — Impact: ${node.impactScore}, Severity: ${node.severity}`);
    }
    lines.push('');
  }

  // Migration status (generic)
  const migrations = store.migrationEntries.filter(e => feature.files.includes(e.sourceComponent));
  if (migrations.length > 0) {
    lines.push(`## ${getMigrationLabel(store)} Status`);
    lines.push('');
    for (const entry of migrations) {
      lines.push(`- \`${entry.sourceComponent}\` → ${entry.targetComponent || '(no target equivalent)'} — **${entry.status}**`);
    }
    lines.push('');
  }

  lines.push('## Watch List');
  lines.push('');
  lines.push('When making changes to this feature, watch for:');
  lines.push('');

  if (impactNodes.length > 0) {
    lines.push('- [ ] Changes to high-impact files (see above)');
  }
  if (migrations.some(m => m.bridgeEvents.length > 0)) {
    const events = migrations.flatMap(m => m.bridgeEvents);
    lines.push(`- [ ] Event bridge changes: ${[...new Set(events)].map(e => `\`${e}\``).join(', ')}`);
  }
  lines.push('- [ ] Verify tests pass after changes');
  lines.push('- [ ] Check cross-feature imports are not broken');
  lines.push('');

  return lines.join('\n');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function writeJsonReport(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
}

function sanitizeMermaidId(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

function gradeEmoji(score: number): string {
  if (score >= 8) return '🟢';
  if (score >= 6) return '🟡';
  if (score >= 4) return '🟠';
  return '🔴';
}
