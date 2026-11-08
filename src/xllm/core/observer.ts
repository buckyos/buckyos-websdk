// Waist worklog events → run events for the host's observer (Rust `ObserverWorklog`).

import type { RunEvent, RunObserver, WorkEvent } from './types'
import type { WorklogSink } from './deps'
import { nowMs } from './messages'

export const noopObserver: RunObserver = { onEvent() {} }

const TOOL_SHELL = 'shell'

export class ObserverWorklog implements WorklogSink {
  private llmStartedAt: number | undefined
  private readonly commands = new Map<string, string>()

  constructor(private readonly runId: string, private readonly observer: RunObserver) {}

  emit(event: WorkEvent) {
    const ev = this.map(event)
    if (ev) this.observer.onEvent(this.runId, ev)
  }

  private map(event: WorkEvent): RunEvent | undefined {
    switch (event.kind) {
      case 'llm_started':
        this.llmStartedAt = nowMs()
        return { kind: 'llm_started', model: event.model }
      case 'llm_finished': {
        const started = this.llmStartedAt
        this.llmStartedAt = undefined
        return { kind: 'llm_finished', ok: event.ok, elapsed_ms: started === undefined ? 0 : Math.max(0, nowMs() - started) }
      }
      case 'llm_inference_failed':
        return { kind: 'warning', message: `model request failed: ${event.error}` }
      case 'tool_call_planned': {
        const command = event.tool === TOOL_SHELL && typeof event.args.command === 'string' ? event.args.command : undefined
        this.commands.delete(event.call_id)
        if (command !== undefined) this.commands.set(event.call_id, command)
        return { kind: 'tool_started', name: event.tool, call_id: event.call_id, ...(command !== undefined ? { command } : {}) }
      }
      case 'tool_call_finished': {
        const command = this.takeCommand(event.call_id)
        return { kind: 'tool_finished', name: event.tool, call_id: event.call_id, ...(command !== undefined ? { command } : {}),
          ok: event.ok, duration_ms: event.duration_ms }
      }
      case 'tool_call_failed': {
        const command = this.takeCommand(event.call_id)
        return { kind: 'tool_finished', name: `${event.tool} (${event.message})`, call_id: event.call_id,
          ...(command !== undefined ? { command } : {}), ok: false, duration_ms: 0 }
      }
      case 'output_parse_failed':
        return { kind: 'warning', message: `response parse failed: ${event.error}` }
      case 'tool_dispatch_failed':
        this.commands.delete(event.call_id)
        return { kind: 'warning', message: `tool \`${event.tool}\` dispatch failed: ${event.message}` }
      case 'checkpoint_failed':
        return { kind: 'warning', message: `checkpoint failed: ${event.error}` }
      case 'context_rewritten':
        return { kind: 'debug', message: `context rewritten: ${event.from_messages} -> ${event.to_messages} messages` }
      case 'self_report_set':
        return { kind: 'debug', message: `report set (${event.chars} chars)` }
    }
  }

  private takeCommand(callId: string): string | undefined {
    const c = this.commands.get(callId)
    this.commands.delete(callId)
    return c
  }
}
