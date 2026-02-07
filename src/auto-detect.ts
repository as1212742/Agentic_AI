// ============================================================================
// Project Inspector — Auto-Detection Module
// Automatically discovers project structure, frameworks, and patterns
// No manual configuration needed — 100% automatic
// ============================================================================

import { join, relative, basename } from 'node:path';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import type { ProjectConfig, DetectedPackage, DetectedStateManager, MigrationInfo, FeatureFlagInfo } from './types.js';

// ─── Main Entry ─────────────────────────────────────────────────────────────

export async function autoDetect(rootDir: string): Promise<ProjectConfig> {
  console.log('🔎 Auto-detecting project configuration...');

  const monorepoTool = detectMonorepoTool(rootDir);
  console.log(`  📦 Monorepo tool: ${monorepoTool}`);

  const packages = discoverPackages(rootDir, monorepoTool);
  console.log(`  📦 Found ${packages.length} workspace packages:`);
  for (const pkg of packages) {
    console.log(`      ${pkg.dir} → ${pkg.framework}`);
  }

  const aliases = detectAliases(rootDir, packages);
  console.log(`  🔗 Path aliases: ${Object.keys(aliases).length}`);
  for (const [alias, target] of Object.entries(aliases)) {
    console.log(`      ${alias} → ${target}`);
  }

  const entryPatterns = generateEntryPatterns(packages);
  console.log(`  🚪 Entry patterns: ${entryPatterns.length}`);

  const conventionPaths = discoverConventionPaths(rootDir, packages);
  console.log(`  📂 Convention paths: ${conventionPaths.length}`);
  for (const p of conventionPaths) {
    console.log(`      ${p}`);
  }

  const stateManagement = detectStateManagement(rootDir, packages);
  if (stateManagement.length > 0) {
    console.log(`  🏪 State management:`);
    for (const sm of stateManagement) {
      console.log(`      ${sm.type} in ${sm.storeDir}`);
    }
  } else {
    console.log(`  🏪 No state management detected`);
  }

  const migration = detectMigration(packages);
  if (migration) {
    console.log(`  🔄 Migration detected: ${migration.from} → ${migration.to}`);
    console.log(`      Source packages: ${migration.sourcePackages.join(', ')}`);
    console.log(`      Target packages: ${migration.targetPackages.join(', ')}`);
  } else {
    console.log(`  🔄 No migration detected`);
  }

  const featureFlags = detectFeatureFlags(rootDir, packages);
  if (featureFlags) {
    console.log(`  🚩 Feature flags: ${featureFlags.system}`);
  } else {
    console.log(`  🚩 No feature flag system detected`);
  }

  return {
    monorepoTool,
    packages,
    aliases,
    entryPatterns,
    conventionPaths,
    stateManagement,
    migration,
    featureFlags,
  };
}

// ─── Monorepo Detection ─────────────────────────────────────────────────────

function detectMonorepoTool(rootDir: string): ProjectConfig['monorepoTool'] {
  if (existsSync(join(rootDir, 'pnpm-workspace.yaml'))) return 'pnpm';
  if (existsSync(join(rootDir, 'nx.json'))) return 'nx';
  if (existsSync(join(rootDir, 'turbo.json'))) return 'turborepo';
  if (existsSync(join(rootDir, 'lerna.json'))) return 'lerna';

  const rootPkg = readJsonSafe(join(rootDir, 'package.json'));
  if (rootPkg?.workspaces) {
    return existsSync(join(rootDir, 'yarn.lock')) ? 'yarn' : 'npm';
  }

  return 'none';
}

// ─── Package Discovery ──────────────────────────────────────────────────────

function discoverPackages(rootDir: string, tool: ProjectConfig['monorepoTool']): DetectedPackage[] {
  const packages: DetectedPackage[] = [];
  const globs = getWorkspaceGlobs(rootDir, tool);
  const seenDirs = new Set<string>();

  for (const glob of globs) {
    if (glob.includes('*')) {
      // Glob pattern: "packages/*" or "apps/*"
      const baseDir = glob.split('*')[0].replace(/\/+$/, '');
      const searchDir = join(rootDir, baseDir);
      if (!existsSync(searchDir)) continue;

      try {
        const entries = readdirSync(searchDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const pkgDir = join(searchDir, entry.name);
          addPackageIfValid(rootDir, pkgDir, packages, seenDirs);
        }
      } catch { /* ignore */ }
    } else {
      // Exact directory
      addPackageIfValid(rootDir, join(rootDir, glob), packages, seenDirs);
    }
  }

  // Also scan root-level directories for packages not caught by workspace globs
  try {
    const rootEntries = readdirSync(rootDir, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const pkgDir = join(rootDir, entry.name);
      addPackageIfValid(rootDir, pkgDir, packages, seenDirs);
    }
  } catch { /* ignore */ }

  // If still no packages found, treat root as a single project
  if (packages.length === 0) {
    const rootPkg = readJsonSafe(join(rootDir, 'package.json'));
    if (rootPkg) {
      packages.push({
        dir: '.',
        framework: detectFramework(rootPkg),
        name: rootPkg.name || basename(rootDir),
        aliases: {},
      });
    }
  }

  return packages;
}

function getWorkspaceGlobs(rootDir: string, tool: ProjectConfig['monorepoTool']): string[] {
  const globs: string[] = [];

  if (tool === 'pnpm') {
    const yaml = readSafe(join(rootDir, 'pnpm-workspace.yaml'));
    const match = yaml.match(/packages:\s*\n((?:\s*-\s*.+\n?)*)/);
    if (match) {
      for (const line of match[1].split('\n')) {
        const globMatch = line.match(/-\s*['"]?([^'"#\n]+)['"]?\s*$/);
        if (globMatch) globs.push(globMatch[1].trim());
      }
    }
  } else if (tool === 'yarn' || tool === 'npm' || tool === 'turborepo') {
    const rootPkg = readJsonSafe(join(rootDir, 'package.json'));
    if (rootPkg?.workspaces) {
      const ws = Array.isArray(rootPkg.workspaces)
        ? rootPkg.workspaces
        : rootPkg.workspaces.packages || [];
      globs.push(...ws);
    }
  } else if (tool === 'lerna') {
    const lernaJson = readJsonSafe(join(rootDir, 'lerna.json'));
    if (lernaJson?.packages) globs.push(...lernaJson.packages);
    else globs.push('packages/*');
  } else if (tool === 'nx') {
    globs.push('apps/*', 'libs/*', 'packages/*');
  }

  return globs;
}

function addPackageIfValid(
  rootDir: string,
  pkgDir: string,
  packages: DetectedPackage[],
  seenDirs: Set<string>
): void {
  const relDir = relative(rootDir, pkgDir).replace(/\\/g, '/');
  if (seenDirs.has(relDir) || relDir === '' || relDir === '.') return;

  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) return;

  const pkgJson = readJsonSafe(pkgJsonPath);
  if (!pkgJson) return;

  // Skip if it doesn't look like a real app/lib
  const hasDeps = pkgJson.dependencies || pkgJson.devDependencies;
  const hasSrc = existsSync(join(pkgDir, 'src'));
  const hasPages = existsSync(join(pkgDir, 'pages'));
  const hasComponents = existsSync(join(pkgDir, 'components'));
  if (!hasDeps && !hasSrc && !hasPages && !hasComponents) return;

  seenDirs.add(relDir);
  packages.push({
    dir: relDir,
    framework: detectFramework(pkgJson),
    name: pkgJson.name || relDir,
    aliases: {},
  });
}

// ─── Framework Detection ────────────────────────────────────────────────────

function detectFramework(pkgJson: Record<string, unknown>): string {
  if (!pkgJson) return 'unknown';
  const allDeps: Record<string, string> = {
    ...((pkgJson.dependencies as Record<string, string>) || {}),
    ...((pkgJson.devDependencies as Record<string, string>) || {}),
  };

  // Meta-frameworks (most specific first)
  if (allDeps['nuxt'] || allDeps['nuxt3'] || allDeps['@nuxt/kit']) {
    const ver = allDeps['nuxt'] || allDeps['nuxt3'] || '';
    return ver.match(/^[\^~]?3/) ? 'nuxt3' : 'nuxt2';
  }
  if (allDeps['next']) return 'next';
  if (allDeps['@angular/core']) return 'angular';
  if (allDeps['@sveltejs/kit']) return 'sveltekit';
  if (allDeps['svelte']) return 'svelte';
  if (allDeps['gatsby']) return 'gatsby';
  if (allDeps['remix'] || allDeps['@remix-run/react']) return 'remix';
  if (allDeps['astro']) return 'astro';

  // UI frameworks
  if (allDeps['vue']) {
    const ver = allDeps['vue'] || '';
    const isVue3 = !!ver.match(/^[\^~]?3/);
    if (allDeps['vite']) return isVue3 ? 'vue3-vite' : 'vue2-vite';
    return isVue3 ? 'vue3' : 'vue2';
  }
  if (allDeps['react'] || allDeps['react-dom']) {
    if (allDeps['vite']) return 'react-vite';
    if (allDeps['webpack'] || allDeps['react-scripts']) return 'react-webpack';
    if (pkgJson.main || pkgJson.exports) return 'react-library';
    return 'react';
  }

  // Build tools / libraries
  if (allDeps['vite']) return 'vite-library';
  if (allDeps['rollup']) return 'library';
  if (allDeps['typescript']) return 'ts-library';

  const name = (pkgJson.name as string) || '';
  if (name.includes('config') || name.includes('shared')) return 'config';

  return 'unknown';
}

// ─── Alias Detection ────────────────────────────────────────────────────────

function detectAliases(rootDir: string, packages: DetectedPackage[]): Record<string, string> {
  const globalAliases: Record<string, string> = {};

  for (const pkg of packages) {
    const pkgAliases: Record<string, string> = {};

    // 1. Check tsconfig.json paths
    const tsconfigPath = join(rootDir, pkg.dir, 'tsconfig.json');
    if (existsSync(tsconfigPath)) {
      const tsconfig = readJsonSafe(tsconfigPath);
      const paths = tsconfig?.compilerOptions?.paths as Record<string, string[]> | undefined;
      if (paths) {
        for (const [alias, targets] of Object.entries(paths)) {
          if (Array.isArray(targets) && targets.length > 0) {
            const cleanAlias = alias.replace('/*', '/');
            const target = targets[0].replace('/*', '/').replace(/^\.\//, '');
            const resolvedTarget = (pkg.dir === '.' ? '' : pkg.dir + '/') + target;
            pkgAliases[cleanAlias] = resolvedTarget;
            globalAliases[cleanAlias] = resolvedTarget;
          }
        }
      }
    }

    // 2. Framework-specific aliases
    if (pkg.framework.startsWith('nuxt')) {
      const prefix = (pkg.dir === '.' ? '' : pkg.dir + '/');
      if (!pkgAliases['@/']) { pkgAliases['@/'] = prefix; globalAliases['@/'] = prefix; }
      if (!pkgAliases['~/']) { pkgAliases['~/'] = prefix; globalAliases['~/'] = prefix; }
    }

    // 3. Check vite.config for resolve.alias (regex-based, approximate)
    for (const configName of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {
      const viteConfigPath = join(rootDir, pkg.dir, configName);
      if (existsSync(viteConfigPath)) {
        const content = readSafe(viteConfigPath);
        const aliasMatches = content.matchAll(/['"](@|~|#)['"]:\s*(?:resolve\([^)]*,\s*)?['"]([^'"]+)['"]/g);
        for (const match of aliasMatches) {
          const alias = match[1] + '/';
          const target = match[2].replace(/^\.\//, '').replace(/^\//, '');
          const resolved = (pkg.dir === '.' ? '' : pkg.dir + '/') + target;
          pkgAliases[alias] = resolved;
          globalAliases[alias] = resolved;
        }
        break;
      }
    }

    pkg.aliases = pkgAliases;
  }

  return globalAliases;
}

// ─── Entry Pattern Generation ───────────────────────────────────────────────

function generateEntryPatterns(packages: DetectedPackage[]): string[] {
  const patterns: string[] = [];

  for (const pkg of packages) {
    const prefix = pkg.dir === '.' ? '' : escapeRegex(pkg.dir) + '\\/';

    if (pkg.framework.startsWith('nuxt')) {
      patterns.push(`^${prefix}pages\\/`);
      patterns.push(`^${prefix}layouts\\/`);
    } else if (pkg.framework === 'next') {
      patterns.push(`^${prefix}app\\/`);
      patterns.push(`^${prefix}pages\\/`);
    } else if (pkg.framework === 'angular') {
      patterns.push(`^${prefix}src\\/main\\.`);
      patterns.push(`^${prefix}src\\/app\\/app\\.`);
    } else if (pkg.framework === 'sveltekit') {
      patterns.push(`^${prefix}src\\/routes\\/`);
    } else if (pkg.framework.includes('react') || pkg.framework.includes('vite')) {
      patterns.push(`^${prefix}src\\/main\\.`);
      patterns.push(`^${prefix}src\\/App\\.`);
      patterns.push(`^${prefix}src\\/index\\.`);
    }
  }

  // Generic: index files are always entry points
  patterns.push('index\\.(ts|tsx|js|jsx|vue)$');

  return patterns;
}

// ─── Convention Paths ───────────────────────────────────────────────────────

function discoverConventionPaths(rootDir: string, packages: DetectedPackage[]): string[] {
  const paths: string[] = [];

  for (const pkg of packages) {
    const prefix = pkg.dir === '.' ? '' : pkg.dir + '/';
    const conventionDirs: string[] = [];

    if (pkg.framework.startsWith('nuxt')) {
      conventionDirs.push('pages', 'layouts', 'middleware', 'plugins', 'mixins', 'store', 'composables');
    } else if (pkg.framework === 'next') {
      conventionDirs.push('app', 'pages', 'middleware');
    } else if (pkg.framework === 'angular') {
      conventionDirs.push('src/app');
    } else if (pkg.framework === 'sveltekit') {
      conventionDirs.push('src/routes', 'src/lib');
    }

    for (const dir of conventionDirs) {
      const fullPath = join(rootDir, pkg.dir, dir);
      if (existsSync(fullPath)) {
        paths.push(prefix + dir + '/');
      }
    }
  }

  return paths;
}

// ─── State Management Detection ─────────────────────────────────────────────

function detectStateManagement(rootDir: string, packages: DetectedPackage[]): DetectedStateManager[] {
  const stores: DetectedStateManager[] = [];

  const STATE_LIBS: Array<{ dep: string; type: string; dirs: string[] }> = [
    { dep: 'vuex', type: 'vuex', dirs: ['store'] },
    { dep: 'pinia', type: 'pinia', dirs: ['stores', 'store'] },
    { dep: '@reduxjs/toolkit', type: 'redux', dirs: ['store', 'stores', 'src/store', 'src/redux'] },
    { dep: 'redux', type: 'redux', dirs: ['store', 'stores', 'src/store', 'src/redux'] },
    { dep: 'zustand', type: 'zustand', dirs: ['stores', 'store', 'src/stores', 'src/store'] },
    { dep: 'mobx', type: 'mobx', dirs: ['stores', 'store', 'src/stores'] },
    { dep: 'mobx-state-tree', type: 'mobx', dirs: ['stores', 'models', 'src/stores'] },
    { dep: '@ngrx/store', type: 'ngrx', dirs: ['src/app/store', 'src/store'] },
    { dep: 'recoil', type: 'recoil', dirs: ['atoms', 'src/atoms', 'stores'] },
    { dep: 'jotai', type: 'jotai', dirs: ['atoms', 'src/atoms'] },
    { dep: 'effector', type: 'effector', dirs: ['stores', 'src/stores'] },
  ];

  for (const pkg of packages) {
    const pkgJsonPath = join(rootDir, pkg.dir, 'package.json');
    const pkgJson = readJsonSafe(pkgJsonPath);
    if (!pkgJson) continue;

    const allDeps: Record<string, string> = {
      ...((pkgJson.dependencies as Record<string, string>) || {}),
      ...((pkgJson.devDependencies as Record<string, string>) || {}),
    };

    for (const lib of STATE_LIBS) {
      if (!allDeps[lib.dep]) continue;

      let found = false;
      for (const dir of lib.dirs) {
        const storePath = join(rootDir, pkg.dir, dir);
        if (existsSync(storePath)) {
          const prefix = pkg.dir === '.' ? '' : pkg.dir + '/';
          stores.push({ type: lib.type, storeDir: prefix + dir, package: pkg.dir });
          found = true;
          break;
        }
      }

      if (!found) {
        const prefix = pkg.dir === '.' ? '' : pkg.dir + '/';
        stores.push({ type: lib.type, storeDir: prefix + 'src', package: pkg.dir });
      }
    }
  }

  // Deduplicate: if both 'redux' and '@reduxjs/toolkit' detected for same package, keep one
  const seen = new Set<string>();
  return stores.filter(s => {
    const key = `${s.package}:${s.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Migration Detection ────────────────────────────────────────────────────

const UI_FRAMEWORKS = new Set([
  'vue2', 'vue3', 'vue2-vite', 'vue3-vite', 'nuxt2', 'nuxt3',
  'react', 'react-vite', 'react-webpack', 'react-library',
  'next', 'angular', 'svelte', 'sveltekit', 'gatsby', 'remix',
]);

const FRAMEWORK_EXTENSIONS: Record<string, string[]> = {
  'vue2': ['.vue'], 'vue3': ['.vue'], 'vue2-vite': ['.vue'], 'vue3-vite': ['.vue'],
  'nuxt2': ['.vue'], 'nuxt3': ['.vue'],
  'react': ['.tsx', '.jsx'], 'react-vite': ['.tsx', '.jsx'], 'react-webpack': ['.tsx', '.jsx'],
  'react-library': ['.tsx', '.jsx'], 'next': ['.tsx', '.jsx'],
  'angular': ['.ts'], 'svelte': ['.svelte'], 'sveltekit': ['.svelte'],
  'gatsby': ['.tsx', '.jsx'], 'remix': ['.tsx', '.jsx'],
};

const FRAMEWORK_FAMILY: Record<string, string> = {
  'vue2': 'vue', 'vue3': 'vue', 'vue2-vite': 'vue', 'vue3-vite': 'vue',
  'nuxt2': 'vue', 'nuxt3': 'vue',
  'react': 'react', 'react-vite': 'react', 'react-webpack': 'react',
  'react-library': 'react', 'next': 'react', 'gatsby': 'react', 'remix': 'react',
  'angular': 'angular', 'svelte': 'svelte', 'sveltekit': 'svelte',
};

function detectMigration(packages: DetectedPackage[]): MigrationInfo | null {
  const familyPackages = new Map<string, DetectedPackage[]>();

  for (const pkg of packages) {
    if (!UI_FRAMEWORKS.has(pkg.framework)) continue;
    const family = FRAMEWORK_FAMILY[pkg.framework] || pkg.framework;
    if (!familyPackages.has(family)) familyPackages.set(family, []);
    familyPackages.get(family)!.push(pkg);
  }

  if (familyPackages.size < 2) return null;

  // Heuristic: legacy → modern priority (earlier in list = more likely "from")
  const priorityOrder = ['angular', 'vue', 'react', 'svelte'];
  const families = [...familyPackages.keys()].sort(
    (a, b) => priorityOrder.indexOf(a) - priorityOrder.indexOf(b)
  );

  const fromFamily = families[0];
  const toFamily = families[families.length - 1];
  const fromPkgs = familyPackages.get(fromFamily)!;
  const toPkgs = familyPackages.get(toFamily)!;

  const sourceExtensions = new Set<string>();
  const targetExtensions = new Set<string>();

  for (const pkg of fromPkgs) {
    (FRAMEWORK_EXTENSIONS[pkg.framework] || []).forEach(e => sourceExtensions.add(e));
  }
  for (const pkg of toPkgs) {
    (FRAMEWORK_EXTENSIONS[pkg.framework] || []).forEach(e => targetExtensions.add(e));
  }

  return {
    detected: true,
    from: fromFamily,
    to: toFamily,
    sourcePackages: fromPkgs.map(p => p.dir),
    targetPackages: toPkgs.map(p => p.dir),
    sourceExtensions: [...sourceExtensions],
    targetExtensions: [...targetExtensions],
  };
}

// ─── Feature Flag Detection ─────────────────────────────────────────────────

function detectFeatureFlags(rootDir: string, packages: DetectedPackage[]): FeatureFlagInfo | null {
  const FLAG_DEPS: Record<string, string> = {
    'launchdarkly-js-client-sdk': 'launchdarkly',
    'launchdarkly-react-client-sdk': 'launchdarkly',
    'launchdarkly-node-server-sdk': 'launchdarkly',
    '@launchdarkly/server-sdk': 'launchdarkly',
    '@launchdarkly/node-server-sdk': 'launchdarkly',
    'ld-vue': 'launchdarkly',
    'unleash-client': 'unleash',
    '@unleash/proxy-client-react': 'unleash',
    'flagsmith': 'flagsmith',
    '@flagsmith/react': 'flagsmith',
    '@splitsoftware/splitio': 'split',
    '@splitsoftware/splitio-react': 'split',
    'configcat-js': 'configcat',
    'configcat-react': 'configcat',
    '@growthbook/growthbook-react': 'growthbook',
    '@growthbook/growthbook': 'growthbook',
    '@happykit/flags': 'happykit',
    '@vercel/flags': 'vercel-flags',
    '@openfeature/js-sdk': 'openfeature',
    '@openfeature/react-sdk': 'openfeature',
  };

  for (const pkg of packages) {
    const pkgJsonPath = join(rootDir, pkg.dir, 'package.json');
    const pkgJson = readJsonSafe(pkgJsonPath);
    if (!pkgJson) continue;

    const allDeps: Record<string, string> = {
      ...((pkgJson.dependencies as Record<string, string>) || {}),
      ...((pkgJson.devDependencies as Record<string, string>) || {}),
    };

    for (const [dep, system] of Object.entries(FLAG_DEPS)) {
      if (allDeps[dep]) {
        return { detected: true, system };
      }
    }
  }

  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function readJsonSafe(filePath: string): any {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readSafe(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

