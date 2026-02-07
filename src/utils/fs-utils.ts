// ============================================================================
// File System Utilities
// ============================================================================

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import type { DetectedPackage } from '../types.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.nuxt',
  '.output',
  '.next',
  'coverage',
  '.inspector-cache',
  '.cursor',
  'static',
  'public'
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.mjs', '.cjs', '.svelte']);

export function walkSourceFiles(rootDir: string, extensions = SOURCE_EXTENSIONS): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (extensions.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(rootDir);
  return results;
}

export function readFileSafe(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export function countLines(content: string): number {
  if (!content) return 0;
  return content.split('\n').length;
}

export function getLanguage(ext: string): 'typescript' | 'javascript' | 'vue' | 'css' | 'json' | 'other' {
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.vue':
    case '.svelte':
      return 'vue';
    case '.css':
    case '.scss':
    case '.less':
      return 'css';
    case '.json':
      return 'json';
    default:
      return 'other';
  }
}

/**
 * Generic package detection using auto-detected workspace packages.
 * Falls back to directory-based heuristics if no config provided.
 */
export function detectPackage(filePath: string, rootDir: string, packages?: DetectedPackage[]): string {
  const rel = relative(rootDir, filePath);
  const parts = rel.split('/');

  if (packages && packages.length > 0) {
    // Sort packages by dir length descending so deeper matches win
    const sorted = [...packages].sort((a, b) => b.dir.length - a.dir.length);

    for (const pkg of sorted) {
      if (pkg.dir === '.') continue;
      if (rel.startsWith(pkg.dir + '/')) {
        return pkg.dir;
      }
    }
  }

  // Fallback: use first directory as package name
  if (parts.length > 1 && parts[0] !== '.') {
    return parts[0];
  }

  return 'root';
}

export function isTestFile(filePath: string): boolean {
  const name = basename(filePath);
  return (
    name.includes('.spec.') ||
    name.includes('.test.') ||
    name.includes('__test') ||
    filePath.includes('/test/') ||
    filePath.includes('/tests/') ||
    filePath.includes('/__tests__/') ||
    filePath.includes('/cypress/') ||
    filePath.includes('/e2e/')
  );
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}
