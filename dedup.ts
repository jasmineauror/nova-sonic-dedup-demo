/**
 * Two stream processors for the same mock Nova Sonic stream:
 *
 *   processStreamNaive   — no deduplication; shows the bug
 *   processStreamWithDedup — tracks SPECULATIVE contentIds; shows the fix
 *
 * The fix mirrors what ships in production DENTSI (nova-sonic.ts).
 */

import { StreamEvent } from './mock-stream.js';

// Simulates a database tool call (search_patients, book_appointment, etc.)
async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<string> {
  console.log(`    >> [DB] ${toolName}(${JSON.stringify(input)})`);
  // Simulate async DB round-trip
  await new Promise((r) => setTimeout(r, 10));
  return JSON.stringify({ patient: 'Sarah Johnson', nextAppointment: '2026-06-01' });
}

// ── Naive: no dedup ──────────────────────────────────────────────────────────

/**
 * Processes every event including SPECULATIVE ones.
 * Bug: the tool call fires twice with identical args — in a real call,
 * the second DB result overwrites the first mid-stream while the model
 * is already speaking the answer from the first.
 */
export async function processStreamNaive(
  stream: AsyncGenerator<StreamEvent>,
): Promise<void> {
  console.log('\n── WITHOUT deduplication ──────────────────────────────');
  for await (const evt of stream) {
    if ('textOutput' in evt) {
      console.log(`  [text] "${evt.textOutput.content}"`);
    }
    if ('toolUse' in evt) {
      console.log(`  [tool] ${evt.toolUse.toolName} — stage unknown, executing anyway`);
      await executeTool(evt.toolUse.toolName, evt.toolUse.input);
    }
  }
}

// ── With dedup ───────────────────────────────────────────────────────────────

/**
 * Tracks which contentIds belong to SPECULATIVE blocks and skips them.
 * Only FINAL (committed) events are acted on.
 *
 * This is the pattern used in production DENTSI (nova-sonic.ts):
 *   const speculativeContentIds = new Set<string>();
 */
export async function processStreamWithDedup(
  stream: AsyncGenerator<StreamEvent>,
): Promise<void> {
  console.log('\n── WITH deduplication ─────────────────────────────────');

  // Track which contentIds are SPECULATIVE so we can skip their events.
  // Nova Sonic emits every assistant block twice: SPECULATIVE then FINAL.
  // We only act on FINAL — the committed, stable version.
  const speculativeContentIds = new Set<string>();

  for await (const evt of stream) {

    // Register SPECULATIVE content blocks on contentStart
    if ('contentStart' in evt) {
      try {
        const extra = JSON.parse(evt.contentStart.additionalModelFields);
        if (extra?.generationStage === 'SPECULATIVE') {
          speculativeContentIds.add(evt.contentStart.contentId);
        }
      } catch {
        // Non-JSON additionalModelFields — treat as FINAL
      }
    }

    // Clean up the Set when the content block closes
    if ('contentEnd' in evt) {
      speculativeContentIds.delete(evt.contentEnd.contentId);
    }

    // Skip SPECULATIVE text output
    if ('textOutput' in evt) {
      if (speculativeContentIds.has(evt.textOutput.contentId)) {
        console.log(`  [skip] SPECULATIVE text — "${evt.textOutput.content}"`);
        continue;
      }
      console.log(`  [text] "${evt.textOutput.content}"`);
    }

    // Skip SPECULATIVE tool calls — only execute FINAL ones
    if ('toolUse' in evt) {
      if (speculativeContentIds.has(evt.toolUse.contentId)) {
        console.log(`  [skip] SPECULATIVE tool call — ${evt.toolUse.toolName}`);
        continue;
      }
      console.log(`  [tool] ${evt.toolUse.toolName} — FINAL, executing`);
      await executeTool(evt.toolUse.toolName, evt.toolUse.input);
    }
  }
}
