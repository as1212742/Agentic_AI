#!/usr/bin/env node
// ============================================================================
// Project Inspector — Multi-Agent Codebase Analyzer (Generic — 100% Automatic)
// ============================================================================
//
// Usage:
//   npx tsx src/index.ts              # Full analysis (auto-detects everything)
//   npx tsx src/index.ts --skip-git   # Skip git history (faster)
//   npx tsx src/index.ts --feature X  # Analyze single feature
//   npx tsx src/index.ts /path/to/any/project  # Analyze any project
//
// Output: ./report/
// ============================================================================

import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createStore } from './store.js';
import { autoDetect } from './auto-detect.js';
import { getFileChurns } from './utils/git.js';
import type { Agent, InspectorStore } from './types.js';

// ── Import Agents ──
import { repoIndexer } from './agents/repo-indexer.js';
import { featureGrouper } from './agents/feature-grouper.js';
import { qualityAnalyzer } from './agents/quality-analyzer.js';
import { bugRiskAnalyzer } from './agents/bug-risk-analyzer.js';
import { duplicationAnalyzer } from './agents/duplication-analyzer.js';
import { impactAnalyzer } from './agents/impact-analyzer.js';
import { migrationTracker } from './agents/migration-tracker.js';
import { bridgeAnalyzer } from './agents/bridge-analyzer.js';
import { deadCodeDetector } from './agents/dead-code-detector.js';
import { storeComplexityAnalyzer } from './agents/store-complexity.js';
import { featureFlagAnalyzer } from './agents/feature-flag-analyzer.js';
import { configDriftDetector } from './agents/config-drift.js';
import { recommendationAgent } from './agents/recommendation.js';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

const args = process.argv.slice(2);
const skipGit = args.includes('--skip-git');
const featureFilter = args.includes('--feature') ? args[args.indexOf('--feature') + 1] : null;
const rootDir = resolve(args.find(a => !a.startsWith('--') && a !== featureFilter) || resolve(import.meta.dirname, '../..'));

// ============================================================================
// Pipeline
// ============================================================================

async function runAgent(agent: Agent, store: InspectorStore): Promise<number> {
  const start = performance.now();
  console.log(`\n🤖 [${agent.name}] — ${agent.description}`);
  try {
    await agent.run(store);
  } catch (error) {
    console.error(`  ❌ Agent "${agent.name}" failed:`, error);
  }
  const elapsed = performance.now() - start;
  console.log(`  ⏱️  ${agent.name} completed in ${(elapsed / 1000).toFixed(1)}s`);
  return elapsed;
}

async function main(): Promise<void> {
  const totalStart = performance.now();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║    🔍 Project Inspector — Generic Multi-Agent Analyzer      ║');
  console.log('║              100% Automatic — Zero Configuration            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Root:     ${rootDir}`);
  console.log(`  Git:      ${skipGit ? 'Skipped' : 'Enabled'}`);
  console.log(`  Feature:  ${featureFilter || 'All'}`);
  console.log('');

  // ════════════════════════════════════════════════════════════════════════
  // Phase 0: Auto-Detection (discovers project structure automatically)
  // ════════════════════════════════════════════════════════════════════════

  console.log('━━━ Phase 0: Auto-Detection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const config = await autoDetect(rootDir);

  // ── Create shared store ──
  const store = createStore(rootDir, skipGit);
  store.config = config;

  console.log('');
  console.log('  ✅ Auto-detection complete. Running agents based on detected config:');
  console.log(`      Monorepo: ${config.monorepoTool}`);
  console.log(`      Packages: ${config.packages.length}`);
  console.log(`      Migration: ${config.migration ? `${config.migration.from} → ${config.migration.to}` : 'None'}`);
  console.log(`      State Mgmt: ${config.stateManagement.length > 0 ? config.stateManagement.map(s => s.type).join(', ') : 'None'}`);
  console.log(`      Feature Flags: ${config.featureFlags ? config.featureFlags.system : 'None'}`);
  console.log('');

  // ════════════════════════════════════════════════════════════════════════
  // Phase 1: Global Indexing (sequential — other agents depend on this)
  // ════════════════════════════════════════════════════════════════════════

  console.log('━━━ Phase 1: Global Indexing ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await runAgent(repoIndexer, store);

  // ── Git history (parallel with Phase 2) ──
  if (!skipGit) {
    console.log('\n📜 Loading git history...');
    const gitStart = performance.now();
    store.gitChurns = getFileChurns(rootDir, 500);
    console.log(`  📜 Git: ${store.gitChurns.size} files with history (${((performance.now() - gitStart) / 1000).toFixed(1)}s)`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 2: Feature Grouping (depends on Phase 1)
  // ════════════════════════════════════════════════════════════════════════

  console.log('\n━━━ Phase 2: Feature Grouping ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await runAgent(featureGrouper, store);

  // Filter to single feature if requested
  if (featureFilter) {
    store.features = store.features.filter(f =>
      f.id.toLowerCase().includes(featureFilter.toLowerCase()) ||
      f.name.toLowerCase().includes(featureFilter.toLowerCase())
    );
    console.log(`  🎯 Filtered to ${store.features.length} matching features`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 3: Analysis (agents run in parallel groups)
  // ════════════════════════════════════════════════════════════════════════

  console.log('\n━━━ Phase 3: Analysis Agents ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Group A: File-level analyzers (always run, can run in parallel)
  const groupA: Agent[] = [qualityAnalyzer, bugRiskAnalyzer];

  // Conditionally add feature flag analyzer (always runs — auto-detects flags)
  groupA.push(featureFlagAnalyzer);

  console.log('\n── Group A: File-level Analysis (parallel) ──');
  await Promise.all(groupA.map(agent => runAgent(agent, store)));

  // Group B: Cross-file analyzers (always run, can run in parallel)
  const groupB: Agent[] = [duplicationAnalyzer, impactAnalyzer, deadCodeDetector];

  console.log('\n── Group B: Cross-file Analysis (parallel) ──');
  await Promise.all(groupB.map(agent => runAgent(agent, store)));

  // Group C: Specialized analyzers (conditionally enabled based on auto-detection)
  const groupC: Agent[] = [];

  // Migration tracker — only if migration detected
  if (config.migration?.detected) {
    groupC.push(migrationTracker);
  }

  // Bridge analyzer — only if migration detected (cross-framework events)
  // OR always run to find orphan events
  groupC.push(bridgeAnalyzer);

  // Store complexity — only if state management detected
  if (config.stateManagement.length > 0) {
    groupC.push(storeComplexityAnalyzer);
  }

  // Config drift — only if multiple packages (monorepo)
  if (config.packages.length > 1) {
    groupC.push(configDriftDetector);
  }

  if (groupC.length > 0) {
    console.log('\n── Group C: Specialized Analysis (parallel) ──');
    await Promise.all(groupC.map(agent => runAgent(agent, store)));
  }

  // ════════════════════════════════════════════════════════════════════════
  // Phase 4: Report Generation
  // ════════════════════════════════════════════════════════════════════════

  console.log('\n━━━ Phase 4: Report Generation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await runAgent(recommendationAgent, store);

  // ════════════════════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════════════════════

  const totalTime = ((performance.now() - totalStart) / 1000).toFixed(1);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    📊 Analysis Complete                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  📁 Files indexed:        ${store.files.size}`);
  console.log(`  🔗 Import edges:         ${store.importGraph.length}`);
  console.log(`  🏷️  Symbols:              ${store.symbols.length}`);
  console.log(`  📦 Packages:             ${store.packages.length}`);
  console.log(`  🧩 Features:             ${store.features.length}`);
  console.log(`  💥 Impact nodes:         ${store.impactNodes.length} (${store.impactNodes.filter(n => n.severity === 'critical').length} critical)`);
  console.log(`  🔄 Duplication pairs:    ${store.duplications.length}`);
  console.log(`  💀 Dead code files:      ${store.deadCode.length}`);
  if (store.bridgeConnections.length > 0) {
    console.log(`  🌉 Bridge connections:   ${store.bridgeConnections.length}`);
  }
  if (store.storeModules.length > 0) {
    console.log(`  🏪 Store modules:        ${store.storeModules.length}`);
  }
  if (store.featureFlags.length > 0) {
    console.log(`  🚩 Feature flags:        ${store.featureFlags.length}`);
  }
  if (store.configDiffs.length > 0) {
    console.log(`  ⚙️  Config drifts:        ${store.configDiffs.length}`);
  }
  if (store.migrationEntries.length > 0) {
    console.log(`  🔄 Migration entries:    ${store.migrationEntries.length}`);
  }
  console.log('');
  console.log(`  ⏱️  Total time: ${totalTime}s`);
  console.log(`  📂 Reports: ${rootDir}/report/`);
  console.log('');

  // Feature scorecard
  if (store.featureScores.length > 0) {
    console.log('  📊 Feature Scorecard (Top 15):');
    console.log('  ┌──────────────────────────────────┬───────┬────────┬───────┬───────┬─────────┬───────┐');
    console.log('  │ Feature                          │ Arch  │ Qual   │ Risk  │ Test  │ Overall │ Grade │');
    console.log('  ├──────────────────────────────────┼───────┼────────┼───────┼───────┼─────────┼───────┤');

    const sorted = [...store.featureScores].sort((a, b) => a.overall - b.overall);
    for (const score of sorted.slice(0, 15)) {
      const feature = store.features.find(f => f.id === score.featureId);
      const name = (feature?.name || score.featureId).padEnd(32).slice(0, 32);
      console.log(`  │ ${name} │ ${pad(score.architecture)} │ ${pad(score.codeQuality)}  │ ${pad(score.bugRisk)} │ ${pad(score.testCoverage)} │ ${pad(score.overall)}   │   ${score.grade}   │`);
    }
    console.log('  └──────────────────────────────────┴───────┴────────┴───────┴───────┴─────────┴───────┘');
  }

  console.log('');
}

function pad(n: number): string {
  return n.toFixed(1).padStart(4);
}

// ── Run ──
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
