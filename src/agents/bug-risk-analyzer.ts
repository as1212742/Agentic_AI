// ============================================================================
// Agent: Bug & Risk Analyzer
// Identifies files and patterns with high bug risk
// ============================================================================

import type { Agent, InspectorStore } from '../types.js';
import { readFileSafe } from '../utils/fs-utils.js';

interface BugPattern {
  name: string;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
}

const BUG_PATTERNS: BugPattern[] = [
  {
    name: 'stale-closure',
    pattern: /useCallback\([^)]*\)\s*$/m,
    severity: 'high',
    description: 'Potential stale closure in useCallback without dependency array',
  },
  {
    name: 'missing-cleanup',
    pattern: /addEventListener\([^)]+\)(?![\s\S]*removeEventListener)/,
    severity: 'high',
    description: 'Event listener added without corresponding cleanup',
  },
  {
    name: 'unsafe-any',
    pattern: /:\s*any\b/,
    severity: 'medium',
    description: 'Unsafe "any" type usage',
  },
  {
    name: 'ts-ignore',
    pattern: /@ts-ignore|@ts-nocheck/,
    severity: 'medium',
    description: 'TypeScript error suppression',
  },
  {
    name: 'eslint-disable',
    pattern: /eslint-disable(?!-next-line)/,
    severity: 'low',
    description: 'ESLint rule disabled for entire file',
  },
  {
    name: 'console-log',
    pattern: /console\.(?:log|warn|error)\(/,
    severity: 'low',
    description: 'Console statement left in code',
  },
  {
    name: 'todo-fixme',
    pattern: /(?:TODO|FIXME|HACK|XXX|BUG)\b/i,
    severity: 'low',
    description: 'Unresolved TODO/FIXME marker',
  },
  {
    name: 'empty-catch',
    pattern: /catch\s*\([^)]*\)\s*\{[\s]*\}/,
    severity: 'high',
    description: 'Empty catch block swallows errors',
  },
  {
    name: 'mutation-in-render',
    pattern: /(?:setState|\.value\s*=).*(?:return\s*<|render\s*\()/s,
    severity: 'critical',
    description: 'State mutation during render',
  },
  {
    name: 'async-no-await',
    pattern: /async\s+\w+\s*\([^)]*\)\s*\{(?![\s\S]*await\b)/,
    severity: 'medium',
    description: 'Async function without await',
  },
];

export const bugRiskAnalyzer: Agent = {
  name: 'Bug & Risk Analyzer',
  description: 'Identifies code patterns that indicate high bug risk',

  async run(store: InspectorStore): Promise<void> {
    console.log('  🐛 Scanning for bug risk patterns...');

    const riskCounts = new Map<string, number>();
    const fileRisks = new Map<string, Array<{ pattern: string; severity: string; line: number }>>();

    for (const [rel, fileNode] of store.files) {
      if (fileNode.language === 'json' || fileNode.language === 'css') continue;

      const content = readFileSafe(fileNode.path);
      if (!content) continue;

      const lines = content.split('\n');
      const risks: Array<{ pattern: string; severity: string; line: number }> = [];

      for (const bp of BUG_PATTERNS) {
        for (let i = 0; i < lines.length; i++) {
          if (bp.pattern.test(lines[i])) {
            risks.push({ pattern: bp.name, severity: bp.severity, line: i + 1 });
            riskCounts.set(bp.name, (riskCounts.get(bp.name) || 0) + 1);
          }
        }
      }

      if (risks.length > 0) {
        fileRisks.set(rel, risks);
      }
    }

    // Store risk info in metrics
    for (const [rel, risks] of fileRisks) {
      const metrics = store.fileMetrics.get(rel);
      if (metrics) {
        // Increase bug risk based on pattern count
        const criticalCount = risks.filter(r => r.severity === 'critical').length;
        const highCount = risks.filter(r => r.severity === 'high').length;
        // Risk is already factored into feature scores via quality analyzer
        // Here we augment the metrics
        metrics.cyclomaticComplexity += criticalCount * 5 + highCount * 2;
      }
    }

    console.log(`  🐛 Found ${fileRisks.size} files with risk patterns`);
    for (const [pattern, count] of riskCounts) {
      if (count > 5) {
        console.log(`      ${pattern}: ${count} instances`);
      }
    }
  },
};

