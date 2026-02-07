// ============================================================================
// Agent: Quality Analyzer (Generic — framework-agnostic scoring)
// Calculates code quality metrics per file and per feature
// ============================================================================

import type { Agent, InspectorStore, FileMetrics } from '../types.js';
import { readFileSafe } from '../utils/fs-utils.js';
import {
  calculateCyclomaticComplexity,
  calculateCognitiveComplexity,
  countFunctions,
  countProps,
  extractVueScriptContent,
} from '../utils/ast.js';

export const qualityAnalyzer: Agent = {
  name: 'Quality Analyzer',
  description: 'Calculates complexity, coupling, and quality metrics per file',

  async run(store: InspectorStore): Promise<void> {
    console.log('  📏 Computing file metrics...');

    // Pre-compute fan-in (how many files import each file)
    const fanInMap = new Map<string, number>();
    const fanOutMap = new Map<string, number>();

    for (const edge of store.importGraph) {
      fanInMap.set(edge.target, (fanInMap.get(edge.target) || 0) + 1);
      fanOutMap.set(edge.source, (fanOutMap.get(edge.source) || 0) + 1);
    }

    let processed = 0;
    for (const [rel, fileNode] of store.files) {
      const content = readFileSafe(fileNode.path);
      const codeContent = fileNode.language === 'vue' ? extractVueScriptContent(content) : content;

      if (!codeContent.trim()) continue;

      const { count: functionCount, maxLength: maxFunctionLength } = countFunctions(codeContent);

      const metrics: FileMetrics = {
        file: rel,
        loc: fileNode.loc,
        cyclomaticComplexity: calculateCyclomaticComplexity(codeContent),
        cognitiveComplexity: calculateCognitiveComplexity(codeContent),
        importCount: store.importGraph.filter(e => e.source === rel).length,
        exportCount: store.symbols.filter(s => s.file === rel && s.isExported).length,
        functionCount,
        maxFunctionLength,
        propCount: countProps(codeContent),
        fanIn: fanInMap.get(rel) || 0,
        fanOut: fanOutMap.get(rel) || 0,
      };

      store.fileMetrics.set(rel, metrics);
      processed++;
    }

    console.log(`  📏 Computed metrics for ${processed} files`);

    // ── Compute Feature Scores ──
    console.log('  ⭐ Computing feature scores...');

    // Determine migration extensions from auto-detected config
    const migration = store.config?.migration;
    const sourceExtensions = new Set(migration?.sourceExtensions || []);
    const targetExtensions = new Set(migration?.targetExtensions || []);
    const hasMigration = migration?.detected && sourceExtensions.size > 0 && targetExtensions.size > 0;

    for (const feature of store.features) {
      const featureFiles = feature.files.filter(f => store.fileMetrics.has(f));
      if (featureFiles.length === 0) continue;

      const metrics = featureFiles.map(f => store.fileMetrics.get(f)!);

      // Architecture score: penalize high coupling, large files, deep nesting
      const avgFanOut = avg(metrics.map(m => m.fanOut));
      const avgLoc = avg(metrics.map(m => m.loc));
      const maxLoc = Math.max(...metrics.map(m => m.loc));
      const architectureScore = clamp(10 - (
        (avgFanOut > 15 ? 3 : avgFanOut > 10 ? 2 : avgFanOut > 5 ? 1 : 0) +
        (avgLoc > 500 ? 3 : avgLoc > 300 ? 2 : avgLoc > 150 ? 1 : 0) +
        (maxLoc > 1000 ? 2 : maxLoc > 500 ? 1 : 0) +
        (featureFiles.length > 50 ? 2 : featureFiles.length > 30 ? 1 : 0)
      ), 0, 10);

      // Code quality: penalize high complexity, long functions
      const avgComplexity = avg(metrics.map(m => m.cyclomaticComplexity));
      const avgCogComplexity = avg(metrics.map(m => m.cognitiveComplexity));
      const avgMaxFnLen = avg(metrics.map(m => m.maxFunctionLength));
      const codeQualityScore = clamp(10 - (
        (avgComplexity > 30 ? 3 : avgComplexity > 20 ? 2 : avgComplexity > 10 ? 1 : 0) +
        (avgCogComplexity > 40 ? 3 : avgCogComplexity > 25 ? 2 : avgCogComplexity > 15 ? 1 : 0) +
        (avgMaxFnLen > 100 ? 2 : avgMaxFnLen > 50 ? 1 : 0)
      ), 0, 10);

      // Bug risk: penalize high fan-in, churn, complexity
      const avgFanIn = avg(metrics.map(m => m.fanIn));
      const maxFanIn = Math.max(...metrics.map(m => m.fanIn));
      const avgChurn = !store.skipGit ? avg(featureFiles.map(f => store.gitChurns.get(f)?.commitCount || 0)) : 0;
      const bugRiskScore = clamp(10 - (
        (avgFanIn > 20 ? 3 : avgFanIn > 10 ? 2 : avgFanIn > 5 ? 1 : 0) +
        (maxFanIn > 30 ? 2 : maxFanIn > 15 ? 1 : 0) +
        (avgChurn > 50 ? 3 : avgChurn > 20 ? 2 : avgChurn > 10 ? 1 : 0) +
        (avgComplexity > 25 ? 2 : avgComplexity > 15 ? 1 : 0)
      ), 0, 10);

      // Test coverage: check if feature files have associated tests
      const testFiles = featureFiles.filter(f =>
        f.includes('.spec.') || f.includes('.test.') ||
        featureFiles.some(t => t.includes('.spec.') || t.includes('.test.'))
      );
      const testRatio = featureFiles.length > 0 ? testFiles.length / featureFiles.length : 0;
      const testCoverageScore = clamp(Math.round(testRatio * 10), 0, 10);

      // Migration health: generic — use auto-detected source/target extensions
      let migrationScore = 5; // neutral default
      if (hasMigration) {
        const sourceFiles = featureFiles.filter(f => [...sourceExtensions].some(ext => f.endsWith(ext)));
        const targetFiles = featureFiles.filter(f => [...targetExtensions].some(ext => f.endsWith(ext)));
        const totalUIFiles = sourceFiles.length + targetFiles.length;
        migrationScore = totalUIFiles > 0
          ? clamp(Math.round((targetFiles.length / totalUIFiles) * 10), 0, 10)
          : 5;
      }

      // Weighted overall (reduce migration weight if no migration detected)
      const migrationWeight = hasMigration ? 0.10 : 0;
      const testWeight = 0.15 + (hasMigration ? 0 : 0.05);
      const overall = (
        architectureScore * 0.30 +
        codeQualityScore * 0.25 +
        bugRiskScore * 0.20 +
        testCoverageScore * testWeight +
        migrationScore * migrationWeight
      );

      const grade = overall >= 8 ? 'A' : overall >= 6 ? 'B' : overall >= 4 ? 'C' : overall >= 2 ? 'D' : 'F';

      store.featureScores.push({
        featureId: feature.id,
        architecture: round(architectureScore),
        codeQuality: round(codeQualityScore),
        bugRisk: round(bugRiskScore),
        testCoverage: round(testCoverageScore),
        migrationHealth: round(migrationScore),
        overall: round(overall),
        grade,
      });
    }

    console.log(`  ⭐ Scored ${store.featureScores.length} features`);
  },
};

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
