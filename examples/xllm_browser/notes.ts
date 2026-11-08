// The page's own state and functions: a saved note and the selection. The
// xllm tools below call exactly these functions — nothing the page's JS could
// not do already.

const NOTE_KEY = 'xllm-demo.note'
const APPLIED_KEY = 'xllm-demo.applied'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return memory.get(key) ?? null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    if (value === null) memory.delete(key)
    else memory.set(key, value)
  }
}

const memory = new Map<string, string>()
const listeners: (() => void)[] = []

export function onNoteChange(f: () => void) {
  listeners.push(f)
}

function changed() {
  listeners.forEach(f => f())
}

export function getNote(): string | null {
  return read(NOTE_KEY)
}

export function setNote(text: string | null) {
  write(NOTE_KEY, text)
  changed()
}

/** Append `text` once per `callId`: running the same call again changes nothing (that is what makes it idempotent). */
export function appendNoteOnce(callId: string, text: string): string {
  const applied: string[] = JSON.parse(read(APPLIED_KEY) ?? '[]')
  if (!applied.includes(callId)) {
    write(NOTE_KEY, (read(NOTE_KEY) ?? '') + text)
    applied.push(callId)
    write(APPLIED_KEY, JSON.stringify(applied))
    changed()
  }
  return `note is now ${(read(NOTE_KEY) ?? '').length} characters`
}

export function clearNote() {
  write(NOTE_KEY, null)
  changed()
}

export function resetDemoState() {
  write(NOTE_KEY, '')
  write(APPLIED_KEY, '[]')
  changed()
}

export function currentSelection(): string {
  return (typeof window !== 'undefined' && window.getSelection?.()?.toString()) || ''
}
