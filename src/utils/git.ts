// ============================================================================
// Git Utilities (read-only)
// ============================================================================

import { execSync } from 'node:child_process';
import { relative } from 'node:path';
import type { GitChurn } from '../types.js';

function exec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return '';
  }
}

/** Get commit count per file (git log --name-only) */
export function getFileChurns(rootDir: string, limit = 500): Map<string, GitChurn> {
  const churns = new Map<string, GitChurn>();

  // Get commit count per file
  const logOutput = exec(`git log --pretty=format:"COMMIT:%H:%an:%aI" --name-only -n ${limit}`, rootDir);

  if (!logOutput) return churns;

  let currentCommit = '';
  let currentAuthor = '';
  let currentDate = '';
  const commitFiles: Map<string, string[]> = new Map(); // commit -> files

  for (const line of logOutput.split('\n')) {
    if (line.startsWith('COMMIT:')) {
      const parts = line.split(':');
      currentCommit = parts[1];
      currentAuthor = parts[2];
      currentDate = parts.slice(3).join(':');
      commitFiles.set(currentCommit, []);
    } else if (line.trim() && currentCommit) {
      const file = line.trim();
      commitFiles.get(currentCommit)?.push(file);

      if (!churns.has(file)) {
        churns.set(file, {
          file,
          commitCount: 0,
          authorCount: 0,
          lastModified: currentDate,
          coChangedWith: []
        });
      }

      const churn = churns.get(file)!;
      churn.commitCount++;
      if (!churn.lastModified || currentDate > churn.lastModified) {
        churn.lastModified = currentDate;
      }
    }
  }

  // Calculate unique authors per file
  const fileAuthors = new Map<string, Set<string>>();
  let prevCommit = '';
  let prevAuthor = '';
  for (const line of logOutput.split('\n')) {
    if (line.startsWith('COMMIT:')) {
      const parts = line.split(':');
      prevCommit = parts[1];
      prevAuthor = parts[2];
    } else if (line.trim() && prevCommit) {
      const file = line.trim();
      if (!fileAuthors.has(file)) fileAuthors.set(file, new Set());
      fileAuthors.get(file)!.add(prevAuthor);
    }
  }

  for (const [file, authors] of fileAuthors) {
    const churn = churns.get(file);
    if (churn) churn.authorCount = authors.size;
  }

  // Calculate co-changed files (files in the same commit)
  for (const [, files] of commitFiles) {
    if (files.length < 2 || files.length > 20) continue; // skip huge commits
    for (const f of files) {
      const churn = churns.get(f);
      if (!churn) continue;
      for (const other of files) {
        if (other !== f && !churn.coChangedWith.includes(other)) {
          churn.coChangedWith.push(other);
        }
      }
      // Cap at 50 co-changes
      if (churn.coChangedWith.length > 50) {
        churn.coChangedWith = churn.coChangedWith.slice(0, 50);
      }
    }
  }

  return churns;
}

/** Check if a file has associated test files in git */
export function getTestFiles(rootDir: string): Set<string> {
  const output = exec('git ls-files -- "*.spec.*" "*.test.*" "*__tests__*"', rootDir);
  return new Set(output.split('\n').filter(Boolean));
}
