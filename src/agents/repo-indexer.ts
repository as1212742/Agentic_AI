// ============================================================================
// Agent: Repo Indexer (Generic — auto-detected config)
// Traverses the entire repo, builds file graph, import graph, symbol index
// ============================================================================

import { relative, extname, dirname, join } from 'node:path';
import type { Agent, InspectorStore, FileNode, WorkspacePackage } from '../types.js';
import {
  walkSourceFiles,
  readFileSafe,
  countLines,
  getLanguage,
  detectPackage,
  readJsonFile
} from '../utils/fs-utils.js';
import { extractImports, extractSymbols, extractVueScriptContent } from '../utils/ast.js';

export const repoIndexer: Agent = {
  name: 'Repo Indexer',
  description: 'Indexes all source files, builds import graph and symbol index',

  async run(store: InspectorStore): Promise<void> {
    const { rootDir, config } = store;
    const detectedPackages = config?.packages || [];

    console.log('  📁 Discovering source files...');
    const files = walkSourceFiles(rootDir);
    console.log(`  📁 Found ${files.length} source files`);

    // ── Index workspace packages ──
    console.log('  📦 Indexing workspace packages...');
    for (const pkg of detectedPackages) {
      const pkgPath = join(rootDir, pkg.dir);
      const pkgJson = readJsonFile<Record<string, unknown>>(join(pkgPath, 'package.json'));
      if (pkgJson) {
        store.packages.push({
          name: (pkgJson.name as string) || pkg.dir,
          path: pkgPath,
          relativePath: pkg.dir,
          framework: pkg.framework,
          dependencies: (pkgJson.dependencies as Record<string, string>) || {},
          devDependencies: (pkgJson.devDependencies as Record<string, string>) || {}
        });
      }
    }

    // ── Index files ──
    console.log('  🔍 Indexing file metadata...');
    for (const filePath of files) {
      const rel = relative(rootDir, filePath);
      const ext = extname(filePath);
      const content = readFileSafe(filePath);

      const fileNode: FileNode = {
        path: filePath,
        relativePath: rel,
        extension: ext,
        loc: countLines(content),
        language: getLanguage(ext),
        package: detectPackage(filePath, rootDir, detectedPackages)
      };

      store.files.set(rel, fileNode);
    }

    // ── Build import graph ──
    console.log('  🔗 Building import graph...');
    const aliases = config?.aliases || {};

    for (const [rel, fileNode] of store.files) {
      const content = readFileSafe(fileNode.path);
      const codeContent = fileNode.language === 'vue' ? extractVueScriptContent(content) : content;

      const rawImports = extractImports(codeContent, rel);

      for (const edge of rawImports) {
        const resolved = resolveImportPath(edge.target, rel, rootDir, store, aliases);
        if (resolved) {
          store.importGraph.push({
            ...edge,
            target: resolved
          });
        }
      }
    }
    console.log(`  🔗 Found ${store.importGraph.length} import edges`);

    // ── Extract symbols ──
    console.log('  🏷️  Extracting symbols...');
    for (const [rel, fileNode] of store.files) {
      const content = readFileSafe(fileNode.path);
      const codeContent = fileNode.language === 'vue' ? extractVueScriptContent(content) : content;
      const symbols = extractSymbols(codeContent, rel);
      store.symbols.push(...symbols);
    }
    console.log(`  🏷️  Found ${store.symbols.length} symbols`);

    // ── Detect entry points (using auto-detected patterns) ──
    console.log('  🚪 Detecting entry points...');
    const entryPatterns = (config?.entryPatterns || []).map(p => new RegExp(p));

    for (const rel of store.files.keys()) {
      if (entryPatterns.some((p) => p.test(rel))) {
        store.entryPoints.push(rel);
      }
    }
    console.log(`  🚪 Found ${store.entryPoints.length} entry points`);
  }
};

/** Resolve a relative import to a file in the index (generic — uses detected aliases) */
function resolveImportPath(
  importPath: string,
  fromFile: string,
  rootDir: string,
  store: InspectorStore,
  aliases: Record<string, string>
): string | null {
  // Skip external modules (node_modules)
  const isRelative = importPath.startsWith('.') || importPath.startsWith('/');
  const isAliased = Object.keys(aliases).some(prefix => importPath.startsWith(prefix.replace(/\/$/, '')));

  if (!isRelative && !isAliased) {
    return null;
  }

  // Handle aliases
  let resolvedPath = importPath;

  for (const [alias, target] of Object.entries(aliases)) {
    const cleanAlias = alias.replace(/\/$/, '');
    if (importPath.startsWith(cleanAlias + '/') || importPath === cleanAlias) {
      resolvedPath = importPath.replace(cleanAlias, target.replace(/\/$/, ''));
      break;
    }
  }

  // Handle relative imports
  if (resolvedPath.startsWith('.')) {
    const fromDir = dirname(fromFile);
    resolvedPath = join(fromDir, resolvedPath);
    resolvedPath = resolvedPath.replace(/\\/g, '/');
  }

  // Try extensions
  const extensions = [
    '.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.mjs',
    '/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.vue'
  ];

  // Check direct match first
  if (store.files.has(resolvedPath)) return resolvedPath;

  for (const ext of extensions) {
    const candidate = resolvedPath + ext;
    if (store.files.has(candidate)) return candidate;
  }

  // Without extension
  const withoutExt = resolvedPath.replace(/\.[^.]+$/, '');
  if (store.files.has(withoutExt)) return withoutExt;

  return null;
}
