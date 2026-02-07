// ============================================================================
// Agent: Feature Grouper (Generic — no hardcoded features)
// Groups files into features using weighted signals + directory analysis
// ============================================================================

import { dirname, basename } from 'node:path';
import type { Agent, InspectorStore, Feature, FeatureSignal, ProjectConfig, DetectedPackage } from '../types.js';

/** Directories that are shared/utility — not features */
const SHARED_DIRS = new Set([
  'common', 'shared', 'utils', 'helpers', 'types', 'assets', 'styles',
  'static', 'public', 'test-utils', 'support', 'plugin', 'plugins',
  'middleware', 'layouts', 'composables', 'hooks', 'lib', 'config',
  'constants', 'interfaces', 'models', 'services', 'api', 'i18n',
  'locales', 'theme', '__tests__', 'tests', 'test', 'mocks',
  '__mocks__', 'fixtures', 'cypress', 'e2e', 'node_modules',
  'dist', 'build', 'ag-grid',
]);

/** Directories that contain feature subdirectories */
const FEATURE_CONTAINERS = new Set([
  'src', 'components', 'features', 'modules', 'views', 'store',
  'pages', 'screens', 'app', 'sections', 'domains', 'patterns',
]);

export const featureGrouper: Agent = {
  name: 'Feature Grouper',
  description: 'Groups files into feature boundaries using multi-signal heuristics',

  async run(store: InspectorStore): Promise<void> {
    const config = store.config;
    const featureMap = new Map<string, Feature>();
    const fileToFeature = new Map<string, string>();

    // ── Signal 1: Folder structure (weight 0.35) ──
    console.log('  📂 Analyzing folder structure...');
    for (const [rel] of store.files) {
      const featureId = detectFeatureFromPath(rel, config);
      if (featureId) {
        if (!featureMap.has(featureId)) {
          featureMap.set(featureId, createFeature(featureId));
        }
        const feature = featureMap.get(featureId)!;
        feature.files.push(rel);
        feature.signals.push({
          type: 'folder',
          weight: 0.35,
          detail: `File path contains feature folder: ${featureId}`,
        });
        fileToFeature.set(rel, featureId);
      }
    }

    // ── Signal 2: Route / pages analysis (weight 0.30) ──
    console.log('  🛣️  Analyzing route structure...');
    const pagesDirs = (config?.conventionPaths || []).filter(p =>
      p.endsWith('pages/') || p.endsWith('app/') || p.endsWith('routes/')
    );

    for (const [rel] of store.files) {
      for (const pagesDir of pagesDirs) {
        if (!rel.startsWith(pagesDir)) continue;

        const routeFeature = detectFeatureFromRoute(rel, pagesDir);
        if (routeFeature && featureMap.has(routeFeature)) {
          const feature = featureMap.get(routeFeature)!;
          if (!feature.entryPoints.includes(rel)) {
            feature.entryPoints.push(rel);
          }
          feature.signals.push({
            type: 'route',
            weight: 0.30,
            detail: `Page route: ${rel}`,
          });
        } else if (routeFeature) {
          if (!featureMap.has(routeFeature)) {
            featureMap.set(routeFeature, createFeature(routeFeature));
          }
          const feature = featureMap.get(routeFeature)!;
          feature.files.push(rel);
          feature.entryPoints.push(rel);
          feature.signals.push({
            type: 'route',
            weight: 0.30,
            detail: `Page route: ${rel}`,
          });
          fileToFeature.set(rel, routeFeature);
        }
      }
    }

    // ── Signal 3: Import clusters (weight 0.20) ──
    console.log('  📊 Analyzing import clusters...');
    for (const edge of store.importGraph) {
      const sourceFeature = fileToFeature.get(edge.source);
      const targetFeature = fileToFeature.get(edge.target);

      if (sourceFeature && !targetFeature) {
        const feature = featureMap.get(sourceFeature)!;
        if (!feature.files.includes(edge.target)) {
          feature.files.push(edge.target);
          feature.signals.push({
            type: 'import-cluster',
            weight: 0.20,
            detail: `Imported by ${edge.source} (feature: ${sourceFeature})`,
          });
          fileToFeature.set(edge.target, sourceFeature);
        }
      }
    }

    // ── Signal 4: Git co-change (weight 0.15) ──
    if (!store.skipGit && store.gitChurns.size > 0) {
      console.log('  📜 Analyzing git co-change clusters...');
      for (const [file, churn] of store.gitChurns) {
        const myFeature = fileToFeature.get(file);
        if (!myFeature) continue;

        for (const coFile of churn.coChangedWith.slice(0, 10)) {
          if (!fileToFeature.has(coFile) && store.files.has(coFile)) {
            const feature = featureMap.get(myFeature)!;
            if (!feature.files.includes(coFile)) {
              feature.files.push(coFile);
              feature.signals.push({
                type: 'git-cochange',
                weight: 0.15,
                detail: `Co-changed with ${file} in git history`,
              });
              fileToFeature.set(coFile, myFeature);
            }
          }
        }
      }
    }

    // ── Assign unassigned files ──
    for (const [rel] of store.files) {
      if (!fileToFeature.has(rel)) {
        const featureId = 'cross-cutting';
        if (!featureMap.has(featureId)) {
          featureMap.set(featureId, {
            ...createFeature(featureId),
            name: 'Cross-Cutting / Shared',
            description: 'Files used across multiple features or not clearly belonging to one feature',
            isCrossCutting: true,
          });
        }
        featureMap.get(featureId)!.files.push(rel);
        fileToFeature.set(rel, featureId);
      }
    }

    // ── Calculate confidence scores ──
    for (const [, feature] of featureMap) {
      const signalTypes = new Set(feature.signals.map(s => s.type));
      const totalWeight = feature.signals.reduce((sum, s) => sum + s.weight, 0);
      const avgWeight = feature.signals.length > 0 ? totalWeight / feature.signals.length : 0;
      feature.confidence = Math.min(1, avgWeight + signalTypes.size * 0.1);

      if (feature.confidence < 0.3 && !feature.isCrossCutting) {
        feature.isCrossCutting = true;
      }
    }

    store.features = [...featureMap.values()];
    console.log(`  ✅ Identified ${store.features.length} features (${store.features.filter(f => !f.isCrossCutting).length} dedicated + ${store.features.filter(f => f.isCrossCutting).length} cross-cutting)`);
  },
};

function createFeature(id: string): Feature {
  // Auto-generate human-readable name from feature ID
  const name = id
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());

  return {
    id,
    name,
    description: `Feature: ${name}`,
    files: [],
    entryPoints: [],
    confidence: 0,
    signals: [],
    isCrossCutting: false,
  };
}

/**
 * Generic feature detection from file path.
 * Scans for feature-container directories and extracts feature names from subdirectories.
 */
function detectFeatureFromPath(filePath: string, config: ProjectConfig | null): string | null {
  const parts = filePath.split('/');
  const packages = config?.packages || [];

  // Try within each detected package
  for (const pkg of packages) {
    const pkgParts = pkg.dir.split('/');
    if (!filePath.startsWith(pkg.dir + '/')) continue;

    const innerParts = parts.slice(pkgParts.length);

    // Pattern: {pkg}/{featureContainer}/{Feature}/...
    if (innerParts.length >= 2 && FEATURE_CONTAINERS.has(innerParts[0])) {
      const candidate = innerParts[1];
      if (!SHARED_DIRS.has(candidate.toLowerCase()) && !candidate.startsWith('.')) {
        return candidate;
      }
    }

    // Pattern: {pkg}/{featureContainer}/{sub}/{Feature}/... (e.g. components/patterns/Feature)
    if (innerParts.length >= 3 && FEATURE_CONTAINERS.has(innerParts[0])) {
      const sub = innerParts[1];
      if (FEATURE_CONTAINERS.has(sub) || sub === 'patterns') {
        const candidate = innerParts[2];
        if (!SHARED_DIRS.has(candidate.toLowerCase()) && !candidate.startsWith('.')) {
          return candidate;
        }
      }
    }
  }

  // Root-level feature containers (not in any package)
  if (parts.length >= 2) {
    if (FEATURE_CONTAINERS.has(parts[0])) {
      const candidate = parts[1];
      if (!SHARED_DIRS.has(candidate.toLowerCase()) && !candidate.startsWith('.')) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Generic route-based feature detection.
 * Works for any framework with pages/routes directories.
 */
function detectFeatureFromRoute(filePath: string, pagesPrefix: string): string | null {
  const routePart = filePath.replace(pagesPrefix, '');
  const parts = routePart.split('/');

  if (parts[0] && !parts[0].startsWith('_') && !parts[0].startsWith('.')) {
    // Return directory name or file name without extension as feature ID
    const featureId = parts[0].replace(/\.[^.]+$/, '');
    if (featureId && featureId !== 'index') {
      return featureId;
    }
  }

  return null;
}
