/**
 * Simulates the bidirectional event stream Amazon Nova Sonic sends over
 * a Bedrock WebSocket connection.
 *
 * In production, events arrive as Uint8Array chunks that are JSON-parsed
 * from the stream. Here we yield plain objects so the demo runs without
 * any AWS credentials or SDK dependencies.
 *
 * Nova Sonic emits every assistant response block TWICE:
 *   1. SPECULATIVE — early preview, may still change
 *   2. FINAL       — committed, stable output
 *
 * Both text blocks and tool calls follow this pattern.
 */

export interface ContentStartEvent {
  contentStart: {
    contentId: string;
    type: 'TEXT' | 'TOOL';
    role: 'ASSISTANT' | 'USER';
    additionalModelFields: string; // JSON string: { generationStage: 'SPECULATIVE' | 'FINAL' }
  };
}

export interface TextOutputEvent {
  textOutput: {
    contentId: string;
    role: 'ASSISTANT' | 'USER';
    content: string;
  };
}

export interface ToolUseEvent {
  toolUse: {
    contentId: string;
    toolName: string;
    toolUseId: string;
    input: Record<string, unknown>;
  };
}

export interface ContentEndEvent {
  contentEnd: {
    contentId: string;
    stopReason?: 'END_TURN' | 'TOOL_USE';
  };
}

export type StreamEvent =
  | ContentStartEvent
  | TextOutputEvent
  | ToolUseEvent
  | ContentEndEvent;

function stage(s: 'SPECULATIVE' | 'FINAL'): string {
  return JSON.stringify({ generationStage: s });
}

/**
 * Mock stream: simulates a caller asking to book an appointment.
 * Nova emits a text response + tool call, each appearing twice
 * (SPECULATIVE first, then FINAL).
 */
export async function* mockNovaStream(): AsyncGenerator<StreamEvent> {
  // ── SPECULATIVE text block ──────────────────────────────────────────
  yield { contentStart: { contentId: 'c1', type: 'TEXT', role: 'ASSISTANT', additionalModelFields: stage('SPECULATIVE') } };
  yield { textOutput:   { contentId: 'c1', role: 'ASSISTANT', content: 'Let me check your appointment...' } };
  yield { contentEnd:   { contentId: 'c1' } };

  // ── SPECULATIVE tool call ───────────────────────────────────────────
  yield { contentStart: { contentId: 'c2', type: 'TOOL', role: 'ASSISTANT', additionalModelFields: stage('SPECULATIVE') } };
  yield { toolUse:      { contentId: 'c2', toolName: 'search_patients', toolUseId: 'tu-spec-001', input: { name: 'Sarah Johnson' } } };
  yield { contentEnd:   { contentId: 'c2', stopReason: 'TOOL_USE' } };

  // Small delay — in production this is network/model latency
  await new Promise((r) => setTimeout(r, 40));

  // ── FINAL text block (same content, now committed) ──────────────────
  yield { contentStart: { contentId: 'c3', type: 'TEXT', role: 'ASSISTANT', additionalModelFields: stage('FINAL') } };
  yield { textOutput:   { contentId: 'c3', role: 'ASSISTANT', content: 'Let me check your appointment...' } };
  yield { contentEnd:   { contentId: 'c3' } };

  // ── FINAL tool call ─────────────────────────────────────────────────
  yield { contentStart: { contentId: 'c4', type: 'TOOL', role: 'ASSISTANT', additionalModelFields: stage('FINAL') } };
  yield { toolUse:      { contentId: 'c4', toolName: 'search_patients', toolUseId: 'tu-final-001', input: { name: 'Sarah Johnson' } } };
  yield { contentEnd:   { contentId: 'c4', stopReason: 'END_TURN' } };
}
