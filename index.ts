/**
 * Nova Sonic SPECULATIVE/FINAL deduplication — runnable demo
 *
 * Run: npm start
 *
 * Expected output:
 *   WITHOUT dedup → tool fires TWICE (SPECULATIVE + FINAL)
 *   WITH dedup    → tool fires ONCE  (SPECULATIVE skipped)
 */

import { mockNovaStream } from './mock-stream.js';
import { processStreamNaive, processStreamWithDedup } from './dedup.js';

console.log('Nova Sonic SPECULATIVE/FINAL deduplication demo');
console.log('='.repeat(52));
console.log();
console.log('Nova Sonic emits each response block twice:');
console.log('  1. SPECULATIVE — early preview, may still change');
console.log('  2. FINAL       — committed, stable output');
console.log();
console.log('Without dedup: tool calls fire on BOTH events.');
console.log('In production this means the same DB query runs twice,');
console.log('and the second result overwrites the first mid-stream');
console.log('while the model is already speaking the first answer.');

(async () => {
  // Show the bug
  await processStreamNaive(mockNovaStream());

  // Show the fix
  await processStreamWithDedup(mockNovaStream());

  console.log();
  console.log('='.repeat(52));
  console.log('The Set<contentId> approach is O(1) per event and adds');
  console.log('no latency — the filter runs synchronously on each chunk');
  console.log('before any async tool execution begins.');
})();
