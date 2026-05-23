# Nova Sonic SPECULATIVE/FINAL Deduplication Demo

A minimal, self-contained reproduction of a streaming deduplication pattern
required when building real-time tool-calling applications on **Amazon Nova Sonic**
(AWS Bedrock bidirectional speech-to-speech).

No AWS credentials required. No external dependencies beyond TypeScript.

---

## The problem

Amazon Nova Sonic emits every assistant response block **twice** on the same
WebSocket stream:

1. **SPECULATIVE** — an early preview, emitted while the model is still generating
2. **FINAL** — the committed, stable version emitted shortly after

Both text output and tool call events follow this pattern. Without handling it,
tool calls (e.g. `search_patients`, `book_appointment`) fire **twice** with
identical arguments:

- The first DB result comes back and the model starts speaking the answer
- The second identical DB query fires, its result overwrites the first mid-stream
- The model loops or gives a stale answer to the caller

In production this surfaced as the AI occasionally repeating a question the
caller had already answered, or giving an answer based on outdated data.
None of this behaviour was documented in the AWS Bedrock / Nova Sonic docs —
it was found by reading raw WebSocket event logs.

---

## The fix

Track which `contentId` values belong to SPECULATIVE blocks using a `Set`.
Skip any text or tool events whose `contentId` is in that set.
Clean up the Set when the block closes (`contentEnd`).

```typescript
const speculativeContentIds = new Set<string>();

// On contentStart: register if SPECULATIVE
const extra = JSON.parse(evt.contentStart.additionalModelFields);
if (extra?.generationStage === 'SPECULATIVE') {
  speculativeContentIds.add(evt.contentStart.contentId);
}

// On contentEnd: clean up
speculativeContentIds.delete(evt.contentEnd.contentId);

// On toolUse: skip if SPECULATIVE
if (speculativeContentIds.has(evt.toolUse.contentId)) continue;
```

O(1) per event. No added latency.

---

## Run it

```bash
npm install
npm start
```

Expected output:

```
── WITHOUT deduplication ──────────────────────────────
  [text] "Let me check your appointment..."
  [tool] search_patients — stage unknown, executing anyway
    >> [DB] search_patients({"name":"Sarah Johnson"})
  [text] "Let me check your appointment..."
  [tool] search_patients — stage unknown, executing anyway
    >> [DB] search_patients({"name":"Sarah Johnson"})   ← fires twice

── WITH deduplication ─────────────────────────────────
  [skip] SPECULATIVE text — "Let me check your appointment..."
  [skip] SPECULATIVE tool call — search_patients
  [text] "Let me check your appointment..."
  [tool] search_patients — FINAL, executing
    >> [DB] search_patients({"name":"Sarah Johnson"})   ← fires once
```

---

## Files

| File | Purpose |
|------|---------|
| `src/mock-stream.ts` | AsyncGenerator that emits mock Nova Sonic events (SPECULATIVE then FINAL) |
| `src/dedup.ts` | Two processors: naive (buggy) and with dedup (fixed) |
| `src/index.ts` | Runs both side-by-side so the difference is visible |

---

## Production context

This pattern is extracted from a production voice AI system for dental clinics.
The real implementation handles concurrent tool calls, barge-in interrupts, and
audio chunk forwarding alongside the deduplication — all on the same stream.
This repo isolates only the deduplication concern.
