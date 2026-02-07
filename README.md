# 🔍 Project Inspector — Generic Multi-Agent Codebase Analyzer

**100% Automatic — Zero Configuration Required**

A powerful, generic codebase analysis tool that automatically discovers project structure, analyzes code quality, detects issues, and generates comprehensive reports. Works with any JavaScript/TypeScript project (monorepo or single package) without any configuration.

## ✨ Features

- **🔎 Auto-Detection**: Automatically discovers monorepo structure, frameworks, state management, migrations, and feature flags
- **📊 Multi-Agent Analysis**: 13 specialized agents analyze different aspects of your codebase
- **🎯 Feature Grouping**: Intelligently groups files into features using multiple heuristics
- **📈 Quality Metrics**: Calculates complexity, coupling, bug risk, and test coverage
- **🔄 Migration Tracking**: Tracks framework migration progress (e.g., Vue → React)
- **🌉 Bridge Analysis**: Validates event bridges and cross-framework communication
- **💀 Dead Code Detection**: Identifies unused exports and orphaned components
- **📋 Interactive Dashboard**: Beautiful HTML dashboard with all metrics and visualizations
- **📝 Auto-Generated Reports**: Markdown reports, Mermaid diagrams, and feature agent specs

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd inspector

# Install dependencies
npm install
```

### Requirements

- **Node.js**: >= 22.0.0
- **npm/pnpm/yarn**: For dependency management

### Basic Usage

```bash
# Analyze current project (auto-detects project root)
npm run inspect

# Skip git history (faster for large repos)
npm run inspect:quick

# Analyze specific feature only
npm run inspect:feature <feature-name>

# Analyze any project
npm run inspect /path/to/project
```

## 📖 Detailed Usage

### Analyze Your Project

The inspector automatically detects:

- Monorepo tool (pnpm, yarn, npm, lerna, nx, turborepo)
- Workspace packages and their frameworks
- Import aliases from `tsconfig.json`
- Entry points (pages, routes, app directories)
- State management (Vuex, Pinia, Redux, Zustand, MobX, NgRx)
- Framework migrations (Vue → React, Angular → React, etc.)
- Feature flag systems (LaunchDarkly, Unleash, Flagsmith)

```bash
# Full analysis (includes git history)
npm run inspect

# Quick analysis (skips git history - faster)
npm run inspect:quick

# Analyze specific feature
npm run inspect:feature portfolios
```

### Analyze External Projects

```bash
# Analyze any project directory
npm run inspect /path/to/any/project

# Example: Analyze a different repo
npm run inspect ~/projects/my-other-app
```

## 📊 Output

All reports are generated in `{project-root}/report/`:

### Main Reports

- **`dashboard.html`** - Interactive HTML dashboard with all metrics
- **`global_index.json`** - Complete project index (files, imports, symbols)
- **`architecture.mmd`** - Mermaid architecture diagram
- **`recommendations.md`** - Actionable refactoring recommendations
- **`duplication.md`** - Code duplication analysis
- **`risk_map.md`** - High-risk zones and fragile components
- **`dead_code.md`** - Unused exports and orphaned files

### Conditional Reports

Generated only when relevant:

- **`migration_status.md`** - Framework migration progress (if migration detected)
- **`bridge_health.md`** - Event bridge validation (if cross-framework detected)
- **`store_complexity.md`** - State management analysis (if state mgmt detected)
- **`config_drift.md`** - Configuration inconsistencies (if monorepo)

### Feature Reports

- **`features/feature-{id}.md`** - One report per detected feature
- **`feature-agents/{id}-AGENT.md`** - Auto-generated agent specs per feature

## 🏗️ Architecture

### Multi-Agent System

The inspector uses a multi-agent architecture where specialized agents analyze different aspects:

| Phase       | Agent                 | Description                                              |
| ----------- | --------------------- | -------------------------------------------------------- |
| **Phase 0** | Auto-Detection        | Discovers project structure automatically                |
| **Phase 1** | Repo Indexer          | Indexes files, builds import graph, extracts symbols     |
| **Phase 2** | Feature Grouper       | Groups files into features using multi-signal heuristics |
| **Phase 3** | Quality Analyzer      | Calculates complexity and quality metrics                |
| **Phase 3** | Bug Risk Analyzer     | Identifies high bug-risk patterns                        |
| **Phase 3** | Duplication Analyzer  | Detects code duplication                                 |
| **Phase 3** | Impact Analyzer       | Finds high blast-radius components                       |
| **Phase 3** | Dead Code Detector    | Identifies unused code                                   |
| **Phase 3** | Migration Tracker     | Tracks migration progress (if detected)                  |
| **Phase 3** | Bridge Analyzer       | Validates event bridges (if detected)                    |
| **Phase 3** | Store Complexity      | Analyzes state management (if detected)                  |
| **Phase 3** | Feature Flag Analyzer | Indexes feature flags (if detected)                      |
| **Phase 3** | Config Drift Detector | Detects config inconsistencies (if monorepo)             |
| **Phase 4** | Recommendation Agent  | Generates reports, diagrams, and dashboard               |

### How It Works

1. **Auto-Detection**: Scans project structure, `package.json` files, `tsconfig.json`, and dependencies
2. **Indexing**: Builds a complete file graph, import graph, and symbol index
3. **Feature Grouping**: Uses folder structure, routes, import clusters, and Git history
4. **Analysis**: Multiple agents run in parallel analyzing different aspects
5. **Reporting**: Aggregates all results into reports, diagrams, and interactive dashboard

## 🎯 Supported Project Types

The inspector works with:

- ✅ **Monorepos**: pnpm, yarn, npm workspaces, lerna, nx, turborepo
- ✅ **Frameworks**: Vue (Nuxt), React (Next.js, Vite), Angular, Svelte, etc.
- ✅ **State Management**: Vuex, Pinia, Redux, Zustand, MobX, NgRx
- ✅ **Languages**: TypeScript, JavaScript, Vue, React, Angular, Svelte
- ✅ **Migrations**: Any framework-to-framework migration (auto-detected)

## 📝 Example Output

### Dashboard Preview

The interactive dashboard (`dashboard.html`) includes:

- **Feature Scorecard**: Quality scores for each feature (Architecture, Code Quality, Bug Risk, Test Coverage)
- **Migration Status**: Progress visualization (if migration detected)
- **Bridge Health**: Event bridge connections and issues
- **Store Complexity**: State management module analysis
- **Risk Map**: High-impact components and fragile zones
- **Dead Code**: Unused exports and orphaned files
- **Config Drift**: Configuration inconsistencies across packages

### Console Output

```
╔══════════════════════════════════════════════════════════════╗
║    🔍 Project Inspector — Generic Multi-Agent Analyzer      ║
║              100% Automatic — Zero Configuration            ║
╚══════════════════════════════════════════════════════════════╝

  Root:     /path/to/project
  Git:      Enabled
  Feature:  All

━━━ Phase 0: Auto-Detection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔎 Auto-detecting project configuration...
  📦 Monorepo tool: pnpm
  📦 Found 7 workspace packages
  🔄 Migration detected: vue → react
  🏪 State management: vuex, pinia, zustand
  🚩 Feature flags: launchdarkly

━━━ Phase 1: Global Indexing ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📁 Found 2904 source files
  🔗 Found 10837 import edges
  🏷️  Found 5909 symbols
  🚪 Found 415 entry points

━━━ Phase 2: Feature Grouping ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ Identified 133 features

━━━ Phase 3: Analysis Agents ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ⭐ Scored 128 features
  🐛 Found 907 files with risk patterns
  🔄 Found 165 duplication pairs
  💥 Found 1946 impact nodes
  💀 Found 177 dead code files
  🔄 Migration status: 51.7% (326/631 components)
  🌉 Found 106 bridge connections
  🏪 Analyzed 704 store modules

━━━ Phase 4: Report Generation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 Dashboard written to report/dashboard.html
  📝 Reports written to /path/to/project/report/

╔══════════════════════════════════════════════════════════════╗
║                    📊 Analysis Complete                     ║
╚══════════════════════════════════════════════════════════════╝

  ⏱️  Total time: 9.1s
  📂 Reports: /path/to/project/report/
```

## 🔧 Configuration

**No configuration needed!** The inspector automatically detects everything.

However, you can customize behavior via CLI flags:

```bash
# Skip git history (faster)
npm run inspect -- --skip-git

# Analyze specific feature
npm run inspect -- --feature portfolios

# Analyze external project
npm run inspect -- /path/to/project
```

## 📦 Project Structure

```
inspector/
├── package.json          # Package configuration
├── tsconfig.json         # TypeScript configuration
├── README.md             # This file
└── src/
    ├── index.ts          # Main CLI entry point
    ├── store.ts          # Centralized data store
    ├── types.ts          # TypeScript type definitions
    ├── auto-detect.ts    # Auto-detection logic
    ├── agents/           # Analysis agents
    │   ├── repo-indexer.ts
    │   ├── feature-grouper.ts
    │   ├── quality-analyzer.ts
    │   ├── bug-risk-analyzer.ts
    │   ├── duplication-analyzer.ts
    │   ├── impact-analyzer.ts
    │   ├── migration-tracker.ts
    │   ├── bridge-analyzer.ts
    │   ├── dead-code-detector.ts
    │   ├── store-complexity.ts
    │   ├── feature-flag-analyzer.ts
    │   ├── config-drift.ts
    │   ├── recommendation.ts
    │   └── dashboard-generator.ts
    └── utils/            # Utility functions
        ├── ast.ts        # AST parsing
        ├── fs-utils.ts   # File system operations
        └── git.ts        # Git history analysis
```

## 🐛 Troubleshooting

### Issue: "Cannot find module" errors

**Solution**: Make sure you've installed dependencies:

```bash
npm install
```

### Issue: "Node version too old"

**Solution**: The inspector requires Node.js >= 22. Update Node.js:

```bash
# Using nvm
nvm install 22
nvm use 22
```

### Issue: Reports not generated

**Solution**: Check that you have write permissions in the project directory. The inspector creates a `report/` directory at the project root.

### Issue: Slow performance

**Solution**: Use `--skip-git` flag to skip git history analysis:

```bash
npm run inspect:quick
```

## 🤝 Contributing

This is a generic, self-contained inspector. To extend it:

1. Add new agents in `src/agents/`
2. Update `src/types.ts` for new data structures
3. Add auto-detection logic in `src/auto-detect.ts` if needed
4. Update `src/index.ts` to include new agents

## 📄 License

[Add your license here]

## 🙏 Acknowledgments

Built with TypeScript, Node.js, and a passion for code quality.

---

**Made with ❤️ for better codebases**
