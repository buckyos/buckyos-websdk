// Shared interrupt / graceful-finish state of one LLMContext instance
// (`llm_context/src/interrupt.rs`). An interrupt drops the inference in
// flight and cancels or abandons the running tool; a finish lets nothing new
// start and settles with every call paired.

export class AbortState {
  private abortedFlag = false
  private finishingFlag = false
  private reasonText: string | undefined
  private readonly controller = new AbortController()
  private abortWaiters: (() => void)[] = []
  private stopWaiters: (() => void)[] = []

  /** Aborts on interrupt (not on a graceful finish). */
  get signal(): AbortSignal {
    return this.controller.signal
  }

  set(reason: string): boolean {
    if (this.abortedFlag) return false
    this.abortedFlag = true
    if (this.reasonText === undefined) this.reasonText = reason
    this.controller.abort()
    this.wake()
    return true
  }

  setFinishing(reason: string): boolean {
    if (this.finishingFlag) return false
    this.finishingFlag = true
    if (this.reasonText === undefined) this.reasonText = reason
    this.wake()
    return true
  }

  isAborted(): boolean {
    return this.abortedFlag
  }

  isFinishing(): boolean {
    return this.finishingFlag
  }

  reason(): string | undefined {
    return this.reasonText
  }

  /** Resolves once interrupted. */
  aborted(): Promise<void> {
    if (this.abortedFlag) return Promise.resolve()
    return new Promise(resolve => this.abortWaiters.push(resolve))
  }

  /** Resolves once interrupted or finishing. */
  stopping(): Promise<void> {
    if (this.abortedFlag || this.finishingFlag) return Promise.resolve()
    return new Promise(resolve => this.stopWaiters.push(resolve))
  }

  private wake() {
    const stop = this.stopWaiters
    this.stopWaiters = []
    stop.forEach(w => w())
    if (this.abortedFlag) {
      const ab = this.abortWaiters
      this.abortWaiters = []
      ab.forEach(w => w())
    }
  }
}

/** The scheduler's handle on a run (`LLMContextInterruptHandle`). */
export class LLMContextInterruptHandle {
  constructor(private readonly state: AbortState) {}

  static standalone(): LLMContextInterruptHandle {
    return new LLMContextInterruptHandle(new AbortState())
  }

  interrupt(reason: string): boolean {
    return this.state.set(reason)
  }

  finish(reason: string): boolean {
    return this.state.setFinishing(reason)
  }

  reason(): string | undefined {
    return this.state.reason()
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
}
