// ============================================================================
// Agent: Bridge Analyzer (Generic — auto-detects cross-framework bridges)
// Analyzes event bridge health across framework boundaries
// ============================================================================

import type { Agent, InspectorStore } from '../types.js';
import { readFileSafe } from '../utils/fs-utils.js';
import { extractEventEmits, extractEventListeners, extractVueScriptContent } from '../utils/ast.js';

export const bridgeAnalyzer: Agent = {
  name: 'Bridge Analyzer',
  description: 'Validates event bridge connections for health and correctness (auto-detected)',

  async run(store: InspectorStore): Promise<void> {
    console.log('  🌉 Analyzing event bridges...');

    const migration = store.config?.migration;
    const sourceExts = new Set(migration?.sourceExtensions || []);
    const targetExts = new Set(migration?.targetExtensions || []);

    // ── Collect all emitters and listeners ──
    const allEmitters: Array<{ event: string; file: string; line: number }> = [];
    const allListenersOn: Array<{ event: string; file: string; line: number }> = [];
    const allListenersOff: Array<{ event: string; file: string; line: number }> = [];

    for (const [rel, fileNode] of store.files) {
      if (fileNode.language === 'json' || fileNode.language === 'css') continue;

      const content = readFileSafe(fileNode.path);
      const codeContent = fileNode.language === 'vue' ? extractVueScriptContent(content) : content;
      if (!codeContent) continue;

      const emits = extractEventEmits(codeContent);
      const listeners = extractEventListeners(codeContent);

      for (const emit of emits) {
        allEmitters.push({ ...emit, file: rel });
      }
      for (const listener of listeners) {
        if (listener.isOn) {
          allListenersOn.push({ event: listener.event, file: rel, line: listener.line });
        } else {
          allListenersOff.push({ event: listener.event, file: rel, line: listener.line });
        }
      }
    }

    // ── Match emitters with listeners ──
    const eventNames = new Set([
      ...allEmitters.map(e => e.event),
      ...allListenersOn.map(l => l.event),
    ]);

    for (const eventName of eventNames) {
      const emitters = allEmitters.filter(e => e.event === eventName);
      const listeners = allListenersOn.filter(l => l.event === eventName);
      const unsubscribers = allListenersOff.filter(l => l.event === eventName);

      if (emitters.length === 0 && listeners.length > 0) {
        for (const listener of listeners) {
          const hasOff = unsubscribers.some(u => u.file === listener.file);
          store.bridgeConnections.push({
            eventName,
            emitterFile: '(none)',
            emitterLine: 0,
            listenerFile: listener.file,
            listenerLine: listener.line,
            hasUnsubscribe: hasOff,
            isHealthy: false,
            issue: 'Orphan listener: no emitter found for this event',
          });
        }
        continue;
      }

      if (emitters.length > 0 && listeners.length === 0) {
        for (const emitter of emitters) {
          store.bridgeConnections.push({
            eventName,
            emitterFile: emitter.file,
            emitterLine: emitter.line,
            listenerFile: null,
            listenerLine: null,
            hasUnsubscribe: false,
            isHealthy: false,
            issue: 'Orphan emitter: no listener registered for this event',
          });
        }
        continue;
      }

      for (const emitter of emitters) {
        for (const listener of listeners) {
          if (emitter.file === listener.file) continue;

          const hasOff = unsubscribers.some(u =>
            u.event === eventName && u.file === listener.file
          );

          let issue: string | undefined;
          let isHealthy = true;

          if (!hasOff) {
            // Check if listener file uses a framework that requires cleanup
            const listenerExt = '.' + listener.file.split('.').pop();
            const needsCleanup = sourceExts.has(listenerExt) || listenerExt === '.vue';
            if (needsCleanup) {
              issue = `Missing .off() unsubscribe — potential memory leak in ${listenerExt} component`;
              isHealthy = false;
            }
          }

          // Detect cross-framework bridge (generic — using auto-detected extensions)
          const emitterExt = '.' + emitter.file.split('.').pop();
          const listenerExt = '.' + listener.file.split('.').pop();
          const emitterIsSource = sourceExts.has(emitterExt);
          const emitterIsTarget = targetExts.has(emitterExt);
          const listenerIsSource = sourceExts.has(listenerExt);
          const listenerIsTarget = targetExts.has(listenerExt);
          const _isCrossFramework =
            (emitterIsSource && listenerIsTarget) || (emitterIsTarget && listenerIsSource);

          store.bridgeConnections.push({
            eventName,
            emitterFile: emitter.file,
            emitterLine: emitter.line,
            listenerFile: listener.file,
            listenerLine: listener.line,
            hasUnsubscribe: hasOff,
            isHealthy,
            issue,
          });
        }
      }
    }

    const healthy = store.bridgeConnections.filter(b => b.isHealthy).length;
    const unhealthy = store.bridgeConnections.filter(b => !b.isHealthy).length;
    console.log(`  🌉 Found ${store.bridgeConnections.length} bridge connections (${healthy} healthy, ${unhealthy} issues)`);
  },
};
