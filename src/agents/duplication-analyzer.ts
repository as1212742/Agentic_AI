// ============================================================================
// Agent: Duplication Analyzer
// Detects code duplication using hash-based chunk comparison
// ============================================================================

import { createHash } from 'node:crypto';
import type { Agent, InspectorStore, DuplicationMatch } from '../types.js';
import { readFileSafe } from '../utils/fs-utils.js';
import { extractVueScriptContent } from '../utils/ast.js';

const MIN_CHUNK_SIZE = 6;   // minimum lines to consider duplication
const MAX_CHUNK_SIZE = 30;  // maximum chunk size to scan
const MAX_DUPLICATES = 200; // cap results

export const duplicationAnalyzer: Agent = {
  name: 'Duplication Analyzer',
  description: 'Detects code duplication across files using hash-based comparison',

  async run(store: InspectorStore): Promise<void> {
    console.log('  🔄 Scanning for code duplication...');

    // Build hash index: hash → [{file, lineStart}]
    const hashIndex = new Map<string, Array<{ file: string; lineStart: number; snippet: string }>>();

    let filesProcessed = 0;
    for (const [rel, fileNode] of store.files) {
      if (fileNode.language === 'json' || fileNode.language === 'css') continue;
      if (fileNode.loc < MIN_CHUNK_SIZE) continue;

      const content = readFileSafe(fileNode.path);
      const codeContent = fileNode.language === 'vue' ? extractVueScriptContent(content) : content;
      if (!codeContent) continue;

      const lines = codeContent.split('\n');

      // Sliding window of chunks
      for (let chunkSize = MIN_CHUNK_SIZE; chunkSize <= Math.min(MAX_CHUNK_SIZE, lines.length); chunkSize += 4) {
        for (let start = 0; start <= lines.length - chunkSize; start += 3) {
          const chunk = lines.slice(start, start + chunkSize)
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('import'))
            .join('\n');

          if (chunk.length < 100) continue; // too short

          const hash = createHash('sha256').update(chunk).digest('hex').slice(0, 16);

          if (!hashIndex.has(hash)) {
            hashIndex.set(hash, []);
          }

          const entries = hashIndex.get(hash)!;
          // Don't duplicate from same file nearby lines
          if (entries.some(e => e.file === rel && Math.abs(e.lineStart - start) < chunkSize)) {
            continue;
          }

          entries.push({
            file: rel,
            lineStart: start + 1,
            snippet: lines.slice(start, start + Math.min(3, chunkSize)).join('\n'),
          });
        }
      }

      filesProcessed++;
    }

    // Find actual duplicates (hash with 2+ entries from different files)
    const matches: DuplicationMatch[] = [];

    for (const [hash, entries] of hashIndex) {
      if (entries.length < 2) continue;

      // Group by file — we want cross-file duplicates
      const fileGroups = new Map<string, typeof entries>();
      for (const entry of entries) {
        if (!fileGroups.has(entry.file)) fileGroups.set(entry.file, []);
        fileGroups.get(entry.file)!.push(entry);
      }

      if (fileGroups.size < 2) continue; // same-file duplication only

      const fileList = [...fileGroups.keys()];
      for (let i = 0; i < fileList.length; i++) {
        for (let j = i + 1; j < fileList.length; j++) {
          const entryA = fileGroups.get(fileList[i])![0];
          const entryB = fileGroups.get(fileList[j])![0];

          matches.push({
            fileA: entryA.file,
            fileB: entryB.file,
            lineStartA: entryA.lineStart,
            lineStartB: entryB.lineStart,
            lineCount: MIN_CHUNK_SIZE,
            hash,
            snippet: entryA.snippet,
          });

          if (matches.length >= MAX_DUPLICATES) break;
        }
        if (matches.length >= MAX_DUPLICATES) break;
      }
      if (matches.length >= MAX_DUPLICATES) break;
    }

    // Deduplicate (same file pairs)
    const seen = new Set<string>();
    store.duplications = matches.filter(m => {
      const key = [m.fileA, m.fileB].sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Calculate duplication percentage
    const totalFiles = store.files.size;
    const filesWithDups = new Set<string>();
    for (const m of store.duplications) {
      filesWithDups.add(m.fileA);
      filesWithDups.add(m.fileB);
    }
    const dupPercentage = totalFiles > 0 ? ((filesWithDups.size / totalFiles) * 100).toFixed(1) : '0';

    console.log(`  🔄 Found ${store.duplications.length} duplication pairs across ${filesWithDups.size} files (${dupPercentage}% of files)`);
  },
};

