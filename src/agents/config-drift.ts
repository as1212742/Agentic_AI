// ============================================================================
// Agent: Config Drift Detector
// Compares tsconfig, eslint, tailwind, and build configs across packages
// ============================================================================

import { join, basename } from 'node:path';
import type { Agent, InspectorStore, ConfigDiff } from '../types.js';
import { readJsonFile, readFileSafe, fileExists } from '../utils/fs-utils.js';

interface TsConfig {
  compilerOptions?: Record<string, unknown>;
  extends?: string;
  include?: string[];
  exclude?: string[];
}

export const configDriftDetector: Agent = {
  name: 'Config Drift Detector',
  description: 'Detects configuration inconsistencies across workspace packages',

  async run(store: InspectorStore): Promise<void> {
    console.log('  ⚙️  Detecting configuration drift...');

    // ── Compare TypeScript configs ──
    const tsConfigs = new Map<string, TsConfig>();
    for (const pkg of store.packages) {
      const tsConfigPath = join(pkg.path, 'tsconfig.json');
      const config = readJsonFile<TsConfig>(tsConfigPath);
      if (config) {
        tsConfigs.set(pkg.relativePath, config);
      }
    }

    const pkgList = [...tsConfigs.keys()];
    for (let i = 0; i < pkgList.length; i++) {
      for (let j = i + 1; j < pkgList.length; j++) {
        const configA = tsConfigs.get(pkgList[i])!;
        const configB = tsConfigs.get(pkgList[j])!;

        if (configA.compilerOptions && configB.compilerOptions) {
          const allKeys = new Set([...Object.keys(configA.compilerOptions), ...Object.keys(configB.compilerOptions)]);

          for (const key of allKeys) {
            const valA = JSON.stringify(configA.compilerOptions[key] ?? '(not set)');
            const valB = JSON.stringify(configB.compilerOptions[key] ?? '(not set)');

            if (valA !== valB) {
              // Only report meaningful differences
              if (
                [
                  'strict',
                  'target',
                  'module',
                  'moduleResolution',
                  'jsx',
                  'lib',
                  'esModuleInterop',
                  'strictNullChecks'
                ].includes(key)
              ) {
                store.configDiffs.push({
                  configType: 'tsconfig',
                  packageA: pkgList[i],
                  packageB: pkgList[j],
                  key: `compilerOptions.${key}`,
                  valueA: valA,
                  valueB: valB
                });
              }
            }
          }
        }
      }
    }

    // ── Compare dependency versions across packages ──
    const depVersions = new Map<string, Map<string, string>>(); // dep → {pkg → version}

    for (const pkg of store.packages) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [dep, version] of Object.entries(allDeps)) {
        if (!depVersions.has(dep)) depVersions.set(dep, new Map());
        depVersions.get(dep)!.set(pkg.relativePath, version);
      }
    }

    // Find deps with conflicting versions
    for (const [dep, versions] of depVersions) {
      const uniqueVersions = new Set(versions.values());
      if (uniqueVersions.size <= 1) continue;
      if (dep.startsWith('@types/')) continue; // skip type-only diffs

      const pkgs = [...versions.entries()];
      for (let i = 0; i < pkgs.length; i++) {
        for (let j = i + 1; j < pkgs.length; j++) {
          if (pkgs[i][1] !== pkgs[j][1]) {
            store.configDiffs.push({
              configType: 'dependency-version',
              packageA: pkgs[i][0],
              packageB: pkgs[j][0],
              key: dep,
              valueA: pkgs[i][1],
              valueB: pkgs[j][1]
            });
          }
        }
      }
    }

    // ── Check for Tailwind config differences ──
    const tailwindConfigs = new Map<string, string>();
    for (const pkg of store.packages) {
      for (const name of ['tailwind.config.mjs', 'tailwind.config.js', 'tailwind.config.ts']) {
        const configPath = join(pkg.path, name);
        if (fileExists(configPath)) {
          tailwindConfigs.set(pkg.relativePath, readFileSafe(configPath));
          break;
        }
      }
    }

    if (tailwindConfigs.size > 1) {
      const pkgs = [...tailwindConfigs.keys()];
      for (let i = 0; i < pkgs.length; i++) {
        for (let j = i + 1; j < pkgs.length; j++) {
          const contentA = tailwindConfigs.get(pkgs[i])!;
          const contentB = tailwindConfigs.get(pkgs[j])!;
          if (contentA !== contentB) {
            store.configDiffs.push({
              configType: 'tailwind',
              packageA: pkgs[i],
              packageB: pkgs[j],
              key: 'tailwind.config',
              valueA: `(${contentA.split('\n').length} lines)`,
              valueB: `(${contentB.split('\n').length} lines)`
            });
          }
        }
      }
    }

    // ── Summary ──
    const byType = new Map<string, number>();
    for (const diff of store.configDiffs) {
      byType.set(diff.configType, (byType.get(diff.configType) || 0) + 1);
    }

    console.log(`  ⚙️  Found ${store.configDiffs.length} config drift issues`);
    for (const [type, count] of byType) {
      console.log(`      ${type}: ${count}`);
    }
  }
};
