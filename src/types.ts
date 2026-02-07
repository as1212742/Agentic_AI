// ============================================================================
// Project Inspector — Shared Types
// ============================================================================

// ─── Auto-Detection Config (100% automatic — no human input) ────────────────

export interface ProjectConfig {
  monorepoTool: 'pnpm' | 'yarn' | 'npm' | 'lerna' | 'nx' | 'turborepo' | 'none';
  packages: DetectedPackage[];
  aliases: Record<string, string>;
  entryPatterns: string[];
  conventionPaths: string[];
  stateManagement: DetectedStateManager[];
  migration: MigrationInfo | null;
  featureFlags: FeatureFlagInfo | null;
}

export interface DetectedPackage {
  dir: string;
  framework: string;
  name: string;
  aliases: Record<string, string>; // package-specific aliases
}

export interface DetectedStateManager {
  type: string; // 'vuex' | 'pinia' | 'redux' | 'zustand' | 'mobx' | 'ngrx' | etc.
  storeDir: string; // relative path to store directory
  package: string; // which workspace package
}

export interface MigrationInfo {
  detected: boolean;
  from: string; // source framework family (e.g. 'vue')
  to: string; // target framework family (e.g. 'react')
  sourcePackages: string[]; // packages using source framework
  targetPackages: string[]; // packages using target framework
  sourceExtensions: string[]; // e.g. ['.vue']
  targetExtensions: string[]; // e.g. ['.tsx', '.jsx']
}

export interface FeatureFlagInfo {
  detected: boolean;
  system: string; // 'launchdarkly' | 'unleash' | 'flagsmith' | etc.
}

// ─── Core Data Structures ───────────────────────────────────────────────────

/** Represents a single source file in the repository */
export interface FileNode {
  path: string;
  relativePath: string;
  extension: string;
  loc: number;
  language: 'typescript' | 'javascript' | 'vue' | 'css' | 'json' | 'other';
  /** Package this file belongs to (monorepo-aware) */
  package: string;
}

/** An edge in the import graph */
export interface ImportEdge {
  source: string; // file that imports
  target: string; // file being imported
  specifiers: string[]; // named imports
  isDefault: boolean;
  isDynamic: boolean;
}

/** A symbol (function, class, component, type) exported from a file */
export interface SymbolEntry {
  name: string;
  kind: 'function' | 'class' | 'component' | 'type' | 'const' | 'enum' | 'mixin' | 'store' | 'other';
  file: string;
  line: number;
  isDefault: boolean;
  isExported: boolean;
}

/** Feature boundary detected by the Feature Grouper */
export interface Feature {
  id: string;
  name: string;
  description: string;
  files: string[];
  entryPoints: string[];
  confidence: number; // 0–1
  signals: FeatureSignal[];
  isCrossCutting: boolean;
}

export interface FeatureSignal {
  type: 'folder' | 'route' | 'import-cluster' | 'git-cochange' | 'store-module';
  weight: number;
  detail: string;
}

/** Quality score for a feature */
export interface FeatureScore {
  featureId: string;
  architecture: number; // 0–10
  codeQuality: number; // 0–10
  bugRisk: number; // 0–10
  testCoverage: number; // 0–10
  migrationHealth: number; // 0–10
  overall: number; // weighted average
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

/** Per-file complexity metrics */
export interface FileMetrics {
  file: string;
  loc: number;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  importCount: number;
  exportCount: number;
  functionCount: number;
  maxFunctionLength: number;
  propCount: number; // for components
  fanIn: number; // how many files import this
  fanOut: number; // how many files this imports
}

/** Duplication report */
export interface DuplicationMatch {
  fileA: string;
  fileB: string;
  lineStartA: number;
  lineStartB: number;
  lineCount: number;
  hash: string;
  snippet: string;
}

/** Blast-radius / fragile zone node */
export interface ImpactNode {
  file: string;
  symbol?: string;
  fanIn: number;
  featureCount: number;
  gitChurn: number;
  hasTests: boolean;
  impactScore: number; // 0–100
  severity: 'critical' | 'high' | 'medium' | 'low';
}

/** Git churn info per file */
export interface GitChurn {
  file: string;
  commitCount: number;
  authorCount: number;
  lastModified: string;
  /** Files commonly changed together */
  coChangedWith: string[];
}

/** Framework migration tracking (generic — not tied to any specific frameworks) */
export interface MigrationEntry {
  sourceComponent: string;
  targetComponent: string | null;
  featureFlag: string | null;
  bridgeEvents: string[];
  status: 'unmigrated' | 'partial' | 'feature-flagged' | 'migrated' | 'unknown';
}

/** Event bridge connection (cross-framework or intra-framework) */
export interface BridgeConnection {
  eventName: string;
  emitterFile: string;
  emitterLine: number;
  listenerFile: string | null;
  listenerLine: number | null;
  hasUnsubscribe: boolean;
  isHealthy: boolean;
  issue?: string;
}

/** Store module analysis (supports Vuex, Redux, Pinia, Zustand, etc.) */
export interface StoreModule {
  name: string;
  file: string;
  storeType: string; // 'vuex' | 'redux' | 'zustand' | 'pinia' | 'mobx' | etc.
  actionCount: number;
  mutationCount: number;
  getterCount: number;
  stateFields: number;
  consumers: string[]; // files that use this store
  hasTests: boolean;
  migratedTo: string | null; // new store path if migrated
}

/** Feature flag reference */
export interface FeatureFlagRef {
  flag: string;
  file: string;
  line: number;
  context: string;
}

/** Config comparison entry */
export interface ConfigDiff {
  configType: string;
  packageA: string;
  packageB: string;
  key: string;
  valueA: string;
  valueB: string;
}

/** Workspace package in the monorepo */
export interface WorkspacePackage {
  name: string;
  path: string;
  relativePath: string;
  framework: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

// ============================================================================
// Agent Interface
// ============================================================================

export interface Agent {
  name: string;
  description: string;
  run(store: InspectorStore): Promise<void>;
}

// ============================================================================
// Central Store (all agents read/write through this)
// ============================================================================

export interface InspectorStore {
  // Config (auto-detected)
  rootDir: string;
  skipGit: boolean;
  config: ProjectConfig | null;

  // Phase 1: Repo Indexer output
  files: Map<string, FileNode>;
  importGraph: ImportEdge[];
  symbols: SymbolEntry[];
  packages: WorkspacePackage[];
  entryPoints: string[];

  // Phase 2: Feature Grouper output
  features: Feature[];

  // Phase 3: Analyzer outputs
  fileMetrics: Map<string, FileMetrics>;
  featureScores: FeatureScore[];
  duplications: DuplicationMatch[];
  impactNodes: ImpactNode[];
  gitChurns: Map<string, GitChurn>;

  // Phase 3b: Specialized analyzers
  migrationEntries: MigrationEntry[];
  bridgeConnections: BridgeConnection[];
  storeModules: StoreModule[];
  featureFlags: FeatureFlagRef[];
  configDiffs: ConfigDiff[];
  deadCode: string[];
}
