// ============================================================================
// Agent: Dashboard Generator (Generic — dynamic labels from auto-detected config)
// Creates a single-page HTML dashboard with all inspector metrics
// ============================================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { InspectorStore } from '../types.js';

export function generateDashboard(store: InspectorStore): void {
  const reportDir = join(store.rootDir, 'report');
  mkdirSync(reportDir, { recursive: true });

  const data = collectDashboardData(store);
  const html = buildHTML(data);
  writeFileSync(join(reportDir, 'dashboard.html'), html);
  console.log('  📊 Dashboard written to report/dashboard.html');
}

// ─── Data Collection ────────────────────────────────────────────────────────

interface DashboardData {
  generated: string;
  projectName: string;
  totalFiles: number;
  totalImports: number;
  totalSymbols: number;
  totalFeatures: number;
  packages: { name: string; framework: string }[];
  // Migration (dynamic labels)
  hasMigration: boolean;
  migrationLabel: string;
  migrationTotal: number;
  migrationMigrated: number;
  migrationFlagged: number;
  migrationPartial: number;
  migrationUnmigrated: number;
  migrationPct: number;
  // Risk
  riskCritical: number;
  riskHigh: number;
  riskMedium: number;
  riskLow: number;
  topRiskFiles: { file: string; fanIn: number; churn: number; score: number; hasTests: boolean }[];
  // Bridge
  hasBridge: boolean;
  bridgeLabel: string;
  bridgeHealthy: number;
  bridgeIssues: number;
  bridgeIssueList: { event: string; issue: string; file: string }[];
  // Feature scores
  featureTable: { name: string; files: number; grade: string; overall: number; arch: number; quality: number; bugRisk: number; testCov: number; migration: number }[];
  // Dead code
  deadCodeTotal: number;
  deadCodeByPkg: { pkg: string; count: number }[];
  // Duplication
  dupTotal: number;
  topDupFiles: { file: string; count: number }[];
  // Store
  hasStores: boolean;
  storeLabel: string;
  storeModules: number;
  storesWithTests: number;
  storesMigrated: number;
  // Config drift
  configDiffs: number;
  // Recommendations
  recommendations: { priority: string; title: string; detail: string; color: string }[];
}

function collectDashboardData(store: InspectorStore): DashboardData {
  const migration = store.config?.migration;
  const migrated = store.migrationEntries.filter(e => e.status === 'migrated').length;
  const flagged = store.migrationEntries.filter(e => e.status === 'feature-flagged').length;
  const partial = store.migrationEntries.filter(e => e.status === 'partial').length;
  const unmigrated = store.migrationEntries.filter(e => e.status === 'unmigrated').length;
  const total = store.migrationEntries.length;

  const critical = store.impactNodes.filter(n => n.severity === 'critical');
  const high = store.impactNodes.filter(n => n.severity === 'high');
  const medium = store.impactNodes.filter(n => n.severity === 'medium');
  const low = store.impactNodes.filter(n => n.severity === 'low');

  const healthyBridges = store.bridgeConnections.filter(b => b.isHealthy);
  const unhealthyBridges = store.bridgeConnections.filter(b => !b.isHealthy);

  const scoreMap = new Map(store.featureScores.map(s => [s.featureId, s]));
  const featureTable = store.features
    .filter(f => !f.isCrossCutting && f.files.length >= 5)
    .sort((a, b) => b.files.length - a.files.length)
    .slice(0, 25)
    .map(f => {
      const s = scoreMap.get(f.id);
      return {
        name: f.name,
        files: f.files.length,
        grade: s?.grade || '-',
        overall: s?.overall || 0,
        arch: s?.architecture || 0,
        quality: s?.codeQuality || 0,
        bugRisk: s?.bugRisk || 0,
        testCov: s?.testCoverage || 0,
        migration: s?.migrationHealth || 0,
      };
    });

  const deadByPkg = new Map<string, number>();
  for (const file of store.deadCode) {
    const fileNode = store.files.get(file);
    const pkg = fileNode?.package || 'root';
    deadByPkg.set(pkg, (deadByPkg.get(pkg) || 0) + 1);
  }

  const fileDupCounts = new Map<string, number>();
  for (const dup of store.duplications) {
    fileDupCounts.set(dup.fileA, (fileDupCounts.get(dup.fileA) || 0) + 1);
    fileDupCounts.set(dup.fileB, (fileDupCounts.get(dup.fileB) || 0) + 1);
  }
  const topDupFiles = [...fileDupCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, count]) => ({ file: shortPath(file), count }));

  // Dynamic labels
  const migrationLabel = migration
    ? `${capitalize(migration.from)} → ${capitalize(migration.to)} Migration`
    : 'Migration';
  const bridgeLabel = migration
    ? `Bridge Health (${capitalize(migration.from)} ↔ ${capitalize(migration.to)})`
    : 'Bridge Health';
  const storeTypes = new Set((store.config?.stateManagement || []).map(s => s.type));
  const storeLabel = storeTypes.size > 0
    ? [...storeTypes].map(capitalize).join(' / ') + ' Store Summary'
    : 'Store Summary';

  // Recommendations
  const recs: DashboardData['recommendations'] = [];
  if (critical.length > 0) {
    recs.push({ priority: 'P0', title: 'Critical Blast-Radius Zones', detail: `${critical.length} files with critical impact — one change can break multiple features`, color: '#dc2626' });
  }
  if (unhealthyBridges.length > 0) {
    recs.push({ priority: 'P1', title: 'Fix Event Bridge Issues', detail: `${unhealthyBridges.length} bridge connections have orphan listeners or missing emitters`, color: '#ea580c' });
  }
  const godStores = store.storeModules.filter(m => m.actionCount + m.mutationCount + m.getterCount > 30);
  if (godStores.length > 0) {
    recs.push({ priority: 'P2', title: 'Decompose God Stores', detail: `${godStores.length} stores have >30 members — split into domain sub-modules`, color: '#d97706' });
  }
  if (unmigrated > 0 && migration) {
    recs.push({ priority: 'P3', title: `Accelerate ${migrationLabel}`, detail: `${unmigrated} components still need migration (${((unmigrated / Math.max(total, 1)) * 100).toFixed(0)}% remaining)`, color: '#2563eb' });
  }
  if (store.configDiffs.length > 0) {
    recs.push({ priority: 'P4', title: 'Resolve Config Drift', detail: `${store.configDiffs.length} configuration differences across packages`, color: '#7c3aed' });
  }
  if (store.deadCode.length > 0) {
    recs.push({ priority: 'P5', title: 'Clean Up Dead Code', detail: `${store.deadCode.length} files appear to be dead code (not imported anywhere)`, color: '#64748b' });
  }
  if (store.duplications.length > 0) {
    recs.push({ priority: 'P6', title: 'Reduce Duplication', detail: `${store.duplications.length} duplication pairs detected — extract shared modules`, color: '#64748b' });
  }

  return {
    generated: new Date().toISOString(),
    projectName: store.config?.packages[0]?.name || 'Project',
    totalFiles: store.files.size,
    totalImports: store.importGraph.length,
    totalSymbols: store.symbols.length,
    totalFeatures: store.features.filter(f => !f.isCrossCutting).length,
    packages: store.packages.map(p => ({ name: p.name, framework: p.framework })),
    hasMigration: !!migration?.detected,
    migrationLabel,
    migrationTotal: total,
    migrationMigrated: migrated,
    migrationFlagged: flagged,
    migrationPartial: partial,
    migrationUnmigrated: unmigrated,
    migrationPct: total > 0 ? Math.round(((migrated + flagged) / total) * 100) : 0,
    riskCritical: critical.length,
    riskHigh: high.length,
    riskMedium: medium.length,
    riskLow: low.length,
    topRiskFiles: high.slice(0, 15).map(n => ({
      file: shortPath(n.file), fanIn: n.fanIn, churn: n.gitChurn, score: n.impactScore, hasTests: n.hasTests,
    })),
    hasBridge: store.bridgeConnections.length > 0,
    bridgeLabel,
    bridgeHealthy: healthyBridges.length,
    bridgeIssues: unhealthyBridges.length,
    bridgeIssueList: unhealthyBridges.slice(0, 15).map(b => ({
      event: b.eventName, issue: b.issue || '', file: shortPath(b.listenerFile || b.emitterFile),
    })),
    featureTable,
    deadCodeTotal: store.deadCode.length,
    deadCodeByPkg: [...deadByPkg.entries()].sort((a, b) => b[1] - a[1]).map(([pkg, count]) => ({ pkg, count })),
    dupTotal: store.duplications.length,
    topDupFiles,
    hasStores: store.storeModules.length > 0,
    storeLabel,
    storeModules: store.storeModules.length,
    storesWithTests: store.storeModules.filter(m => m.hasTests).length,
    storesMigrated: store.storeModules.filter(m => m.migratedTo).length,
    configDiffs: store.configDiffs.length,
    recommendations: recs,
  };
}

function shortPath(p: string): string {
  const parts = p.split('/');
  if (parts.length > 4) {
    return parts[0] + '/…/' + parts.slice(-2).join('/');
  }
  return p;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── HTML Builder ───────────────────────────────────────────────────────────

function buildHTML(d: DashboardData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Project Inspector Dashboard</title>
<style>
  :root {
    --bg: #0f172a; --surface: #1e293b; --surface2: #334155;
    --text: #f1f5f9; --text2: #94a3b8; --accent: #3b82f6;
    --green: #22c55e; --yellow: #eab308; --orange: #f97316;
    --red: #ef4444; --purple: #a855f7; --cyan: #06b6d4;
    --radius: 12px; --shadow: 0 4px 24px rgba(0,0,0,0.3);
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text); min-height:100vh; padding: 24px; }
  .header { text-align:center; margin-bottom:32px; }
  .header h1 { font-size:28px; font-weight:700; background: linear-gradient(135deg, var(--accent), var(--cyan));
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .header .sub { color:var(--text2); margin-top:4px; font-size:13px; }
  .grid { display:grid; gap:20px; max-width:1400px; margin:0 auto; }
  .grid-4 { grid-template-columns: repeat(4, 1fr); }
  .grid-3 { grid-template-columns: repeat(3, 1fr); }
  .grid-2 { grid-template-columns: repeat(2, 1fr); }
  .grid-1 { grid-template-columns: 1fr; }
  @media (max-width:1100px) { .grid-4 { grid-template-columns: repeat(2,1fr); } }
  @media (max-width:700px) { .grid-4,.grid-3,.grid-2 { grid-template-columns: 1fr; } }
  .card { background: var(--surface); border-radius: var(--radius); padding:20px;
    box-shadow: var(--shadow); border: 1px solid var(--surface2); }
  .card h3 { font-size:13px; text-transform:uppercase; letter-spacing:1px;
    color:var(--text2); margin-bottom:12px; }
  .metric { font-size:36px; font-weight:800; line-height:1; }
  .metric-sm { font-size:14px; color:var(--text2); margin-top:4px; }
  .section { margin-top:28px; }
  .section-title { font-size:18px; font-weight:700; margin-bottom:16px;
    padding-bottom:8px; border-bottom:2px solid var(--surface2); }
  .table-wrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; padding:10px 12px; background:var(--surface2); color:var(--text2);
    font-weight:600; text-transform:uppercase; letter-spacing:0.5px; font-size:11px; position:sticky; top:0; }
  td { padding:8px 12px; border-bottom:1px solid var(--surface2); }
  tr:hover td { background: rgba(59,130,246,0.05); }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size:12px; }
  .grade { display:inline-flex; align-items:center; justify-content:center;
    width:32px; height:32px; border-radius:8px; font-weight:800; font-size:14px; }
  .grade-A { background:rgba(34,197,94,0.15); color:var(--green); }
  .grade-B { background:rgba(234,179,8,0.15); color:var(--yellow); }
  .grade-C { background:rgba(249,115,22,0.15); color:var(--orange); }
  .grade-D { background:rgba(239,68,68,0.15); color:var(--red); }
  .grade-F { background:rgba(239,68,68,0.25); color:var(--red); }
  .score-bar { height:6px; border-radius:3px; background:var(--surface2); overflow:hidden; min-width:60px; }
  .score-fill { height:100%; border-radius:3px; transition:width 0.6s ease; }
  .score-fill.good { background:var(--green); }
  .score-fill.ok { background:var(--yellow); }
  .score-fill.warn { background:var(--orange); }
  .score-fill.bad { background:var(--red); }
  .pie-container { display:flex; align-items:center; gap:24px; flex-wrap:wrap; }
  .pie-legend { display:flex; flex-direction:column; gap:6px; }
  .legend-item { display:flex; align-items:center; gap:8px; font-size:13px; }
  .legend-dot { width:12px; height:12px; border-radius:3px; flex-shrink:0; }
  .bar-chart { display:flex; flex-direction:column; gap:8px; }
  .bar-row { display:flex; align-items:center; gap:12px; }
  .bar-label { width:180px; font-size:12px; color:var(--text2); text-align:right;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-shrink:0; }
  .bar { flex:1; height:20px; border-radius:4px; background:var(--surface2); overflow:hidden; position:relative; }
  .bar-fill { height:100%; border-radius:4px; transition:width 0.6s ease; min-width:2px; }
  .bar-value { font-size:11px; color:var(--text2); width:40px; text-align:right; flex-shrink:0; }
  .priority { display:inline-flex; align-items:center; gap:8px; padding:12px 16px;
    border-radius:8px; background:var(--surface2); margin-bottom:8px; width:100%; }
  .priority-badge { font-size:11px; font-weight:800; padding:3px 8px; border-radius:4px; color:#fff; flex-shrink:0; }
  .priority-title { font-weight:600; font-size:14px; }
  .priority-detail { font-size:12px; color:var(--text2); margin-top:2px; }
  .donut-text { font-size:28px; font-weight:800; fill:var(--text); }
  .donut-label { font-size:11px; fill:var(--text2); }
  .status { display:inline-block; width:8px; height:8px; border-radius:50%; }
  .status-ok { background:var(--green); }
  .status-bad { background:var(--red); }
  .pkg-pill { display:inline-flex; align-items:center; gap:6px; padding:6px 12px;
    border-radius:8px; background:var(--surface2); font-size:12px; margin:4px; }
  .pkg-fw { font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(59,130,246,0.15);
    color:var(--accent); font-weight:600; text-transform:uppercase; }
</style>
</head>
<body>

<div class="header">
  <h1>🔍 Project Inspector Dashboard</h1>
  <div class="sub">Generated ${d.generated.split('T')[0]} &nbsp;·&nbsp; ${d.totalFiles.toLocaleString()} files indexed &nbsp;·&nbsp; 100% auto-detected</div>
</div>

<!-- Summary Cards -->
<div class="grid grid-4">
  <div class="card">
    <h3>Total Files</h3>
    <div class="metric">${d.totalFiles.toLocaleString()}</div>
    <div class="metric-sm">${d.totalImports.toLocaleString()} import edges</div>
  </div>
  <div class="card">
    <h3>Features Detected</h3>
    <div class="metric">${d.totalFeatures}</div>
    <div class="metric-sm">${d.totalSymbols.toLocaleString()} exported symbols</div>
  </div>
  ${d.hasMigration ? `<div class="card">
    <h3>${esc(d.migrationLabel)}</h3>
    <div class="metric" style="color:${d.migrationPct >= 50 ? 'var(--green)' : d.migrationPct >= 25 ? 'var(--yellow)' : 'var(--orange)'}">${d.migrationPct}%</div>
    <div class="metric-sm">${d.migrationMigrated} of ${d.migrationTotal} components</div>
  </div>` : `<div class="card">
    <h3>Packages</h3>
    <div class="metric">${d.packages.length}</div>
    <div class="metric-sm">workspace packages</div>
  </div>`}
  <div class="card">
    <h3>Risk Zones</h3>
    <div class="metric" style="color:${d.riskCritical > 0 ? 'var(--red)' : d.riskHigh > 10 ? 'var(--orange)' : 'var(--yellow)'}">${d.riskCritical + d.riskHigh}</div>
    <div class="metric-sm">${d.riskCritical} critical · ${d.riskHigh} high</div>
  </div>
</div>

<!-- Packages -->
<div class="section">
  <div class="section-title">📦 Monorepo Packages</div>
  <div style="display:flex; flex-wrap:wrap; gap:4px;">
    ${d.packages.map(p => `<span class="pkg-pill"><strong>${esc(p.name)}</strong><span class="pkg-fw">${esc(p.framework)}</span></span>`).join('')}
  </div>
</div>

<!-- Row: Migration/Packages + Risk + Bridge/Stores -->
<div class="section grid grid-3">
  ${d.hasMigration ? `<div class="card">
    <h3>${esc(d.migrationLabel)}</h3>
    <div class="pie-container">
      ${svgDonut([
        { value: d.migrationMigrated, color: '#22c55e', label: 'Migrated' },
        { value: d.migrationFlagged, color: '#a855f7', label: 'Flagged' },
        { value: d.migrationPartial, color: '#eab308', label: 'Partial' },
        { value: d.migrationUnmigrated, color: '#64748b', label: 'Unmigrated' },
      ], d.migrationPct + '%')}
      <div class="pie-legend">
        <div class="legend-item"><span class="legend-dot" style="background:#22c55e"></span>Migrated: <strong>${d.migrationMigrated}</strong></div>
        <div class="legend-item"><span class="legend-dot" style="background:#a855f7"></span>Flagged: <strong>${d.migrationFlagged}</strong></div>
        <div class="legend-item"><span class="legend-dot" style="background:#eab308"></span>Partial: <strong>${d.migrationPartial}</strong></div>
        <div class="legend-item"><span class="legend-dot" style="background:#64748b"></span>Unmigrated: <strong>${d.migrationUnmigrated}</strong></div>
      </div>
    </div>
  </div>` : `<div class="card">
    <h3>Code Distribution</h3>
    <div class="bar-chart" style="margin-top:8px;">
      ${d.packages.map(p => deadBar(p.name, d.totalFiles, d.totalFiles, '#3b82f6')).join('')}
    </div>
  </div>`}

  <div class="card">
    <h3>Risk Severity Distribution</h3>
    <div class="bar-chart" style="margin-top:8px;">
      ${riskBar('Critical', d.riskCritical, d.riskCritical + d.riskHigh + d.riskMedium + d.riskLow, '#ef4444')}
      ${riskBar('High', d.riskHigh, d.riskCritical + d.riskHigh + d.riskMedium + d.riskLow, '#f97316')}
      ${riskBar('Medium', d.riskMedium, d.riskCritical + d.riskHigh + d.riskMedium + d.riskLow, '#eab308')}
      ${riskBar('Low', d.riskLow, d.riskCritical + d.riskHigh + d.riskMedium + d.riskLow, '#64748b')}
    </div>
  </div>

  ${d.hasBridge ? `<div class="card">
    <h3>${esc(d.bridgeLabel)}</h3>
    <div class="pie-container">
      ${svgDonut([
        { value: d.bridgeHealthy, color: '#22c55e', label: 'Healthy' },
        { value: d.bridgeIssues, color: '#ef4444', label: 'Issues' },
      ], d.bridgeHealthy + d.bridgeIssues > 0 ? Math.round((d.bridgeHealthy / (d.bridgeHealthy + d.bridgeIssues)) * 100) + '%' : '0%')}
      <div class="pie-legend">
        <div class="legend-item"><span class="legend-dot" style="background:#22c55e"></span>Healthy: <strong>${d.bridgeHealthy}</strong></div>
        <div class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>Issues: <strong>${d.bridgeIssues}</strong></div>
      </div>
    </div>
  </div>` : `<div class="card">
    <h3>Dead Code</h3>
    <div class="metric">${d.deadCodeTotal}</div>
    <div class="metric-sm">potentially unused files</div>
  </div>`}
</div>

<!-- Recommendations -->
<div class="section">
  <div class="section-title">🎯 Prioritized Recommendations</div>
  <div class="grid grid-1" style="gap:8px;">
    ${d.recommendations.map(r => `
      <div class="priority">
        <span class="priority-badge" style="background:${r.color}">${esc(r.priority)}</span>
        <div>
          <div class="priority-title">${esc(r.title)}</div>
          <div class="priority-detail">${esc(r.detail)}</div>
        </div>
      </div>
    `).join('')}
  </div>
</div>

<!-- Feature Scorecard -->
<div class="section">
  <div class="section-title">📋 Feature Scorecard (Top 25)</div>
  <div class="card table-wrap" style="padding:0; max-height:600px; overflow-y:auto;">
    <table>
      <thead>
        <tr>
          <th>#</th><th>Feature</th><th>Files</th><th>Grade</th><th>Overall</th>
          <th>Architecture</th><th>Code Quality</th><th>Bug Risk</th><th>Test Coverage</th>${d.hasMigration ? '<th>Migration</th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${d.featureTable.map((f, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><strong>${esc(f.name)}</strong></td>
            <td>${f.files}</td>
            <td><span class="grade grade-${f.grade}">${f.grade}</span></td>
            <td><strong>${f.overall.toFixed(1)}</strong></td>
            <td>${scoreCell(f.arch)}</td>
            <td>${scoreCell(f.quality)}</td>
            <td>${scoreCell(f.bugRisk)}</td>
            <td>${scoreCell(f.testCov)}</td>
            ${d.hasMigration ? `<td>${scoreCell(f.migration)}</td>` : ''}
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
</div>

<!-- Row: Dead Code + Duplication + Stores -->
<div class="section grid grid-3">
  <div class="card">
    <h3>💀 Dead Code by Package</h3>
    <div class="metric" style="margin-bottom:12px;">${d.deadCodeTotal}</div>
    <div class="bar-chart">
      ${d.deadCodeByPkg.map(p => deadBar(p.pkg, p.count, d.deadCodeTotal)).join('')}
    </div>
  </div>

  <div class="card">
    <h3>🔁 Top Duplication Hotspots</h3>
    <div class="metric" style="margin-bottom:12px;">${d.dupTotal} pairs</div>
    <div class="bar-chart">
      ${d.topDupFiles.map(f => deadBar(f.file, f.count, d.topDupFiles[0]?.count || 1, '#a855f7')).join('')}
    </div>
  </div>

  ${d.hasStores ? `<div class="card">
    <h3>🏪 ${esc(d.storeLabel)}</h3>
    <div style="display:flex; gap:24px; margin-top:8px;">
      <div>
        <div class="metric">${d.storeModules}</div>
        <div class="metric-sm">Total Modules</div>
      </div>
      <div>
        <div class="metric" style="color:var(--green)">${d.storesWithTests}</div>
        <div class="metric-sm">With Tests</div>
      </div>
      <div>
        <div class="metric" style="color:var(--cyan)">${d.storesMigrated}</div>
        <div class="metric-sm">Migrated</div>
      </div>
    </div>
    <div style="margin-top:16px;">
      <div class="metric-sm">Config drift issues: <strong style="color:var(--orange)">${d.configDiffs}</strong></div>
    </div>
  </div>` : `<div class="card">
    <h3>⚙️ Config Drift</h3>
    <div class="metric" style="color:var(--orange)">${d.configDiffs}</div>
    <div class="metric-sm">configuration differences</div>
  </div>`}
</div>

<!-- High-Risk Files Table -->
<div class="section">
  <div class="section-title">⚠️ High-Risk / Fragile Files</div>
  <div class="card table-wrap" style="padding:0; max-height:500px; overflow-y:auto;">
    <table>
      <thead>
        <tr><th>#</th><th>File</th><th>Fan-In</th><th>Churn</th><th>Score</th><th>Tests</th></tr>
      </thead>
      <tbody>
        ${d.topRiskFiles.map((f, i) => `
          <tr>
            <td>${i + 1}</td>
            <td class="mono">${esc(f.file)}</td>
            <td>${f.fanIn}</td>
            <td>${f.churn}</td>
            <td><strong>${f.score}</strong></td>
            <td><span class="status ${f.hasTests ? 'status-ok' : 'status-bad'}"></span> ${f.hasTests ? 'Yes' : 'No'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
</div>

${d.bridgeIssueList.length > 0 ? `
<div class="section">
  <div class="section-title">🔌 Bridge Issues Detail</div>
  <div class="card table-wrap" style="padding:0;">
    <table>
      <thead>
        <tr><th>Event</th><th>File</th><th>Issue</th></tr>
      </thead>
      <tbody>
        ${d.bridgeIssueList.map(b => `
          <tr>
            <td class="mono">${esc(b.event)}</td>
            <td class="mono">${esc(b.file)}</td>
            <td>${esc(b.issue)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
</div>
` : ''}

<div style="text-align:center; padding:40px 0 20px; color:var(--text2); font-size:12px;">
  Generated by <strong>Project Inspector</strong> (Generic — 100% Auto-Detected) · ${d.generated.split('T')[0]}
</div>

</body>
</html>`;
}

// ─── SVG Helpers ────────────────────────────────────────────────────────────

function svgDonut(segments: { value: number; color: string; label: string }[], centerText: string): string {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return '<svg width="120" height="120"></svg>';

  const cx = 60, cy = 60, r = 48, sw = 14;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const paths = segments.map(seg => {
    const pct = seg.value / total;
    const dashLen = pct * circumference;
    const dashOffset = -offset * circumference;
    offset += pct;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}"
      stroke-width="${sw}" stroke-dasharray="${dashLen} ${circumference - dashLen}"
      stroke-dashoffset="${dashOffset}" transform="rotate(-90 ${cx} ${cy})" />`;
  });

  return `<svg width="120" height="120" viewBox="0 0 120 120">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#334155" stroke-width="${sw}" />
    ${paths.join('\n    ')}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-text">${centerText}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="donut-label">of ${total}</text>
  </svg>`;
}

function riskBar(label: string, value: number, max: number, color: string): string {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0;
  return `<div class="bar-row">
    <span class="bar-label">${label}</span>
    <div class="bar"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
    <span class="bar-value">${value.toLocaleString()}</span>
  </div>`;
}

function deadBar(label: string, value: number, max: number, color = '#3b82f6'): string {
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 0;
  return `<div class="bar-row">
    <span class="bar-label" title="${label}">${label}</span>
    <div class="bar"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
    <span class="bar-value">${value}</span>
  </div>`;
}

function scoreCell(score: number): string {
  const cls = score >= 8 ? 'good' : score >= 6 ? 'ok' : score >= 4 ? 'warn' : 'bad';
  return `<div style="display:flex;align-items:center;gap:6px;">
    <div class="score-bar" style="width:60px;"><div class="score-fill ${cls}" style="width:${score * 10}%"></div></div>
    <span style="font-size:12px;color:var(--text2)">${score.toFixed(1)}</span>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
