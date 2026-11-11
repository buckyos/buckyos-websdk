// Windows MoveFileEx returns EPERM or EBUSY while a scanner still has a new
// file open, and also when a directory rename lands on an existing directory.
// A short retry covers the transient lock. The caller decides when to stop.
export async function retryWindowsLock<T>(
  windows: boolean,
  operation: () => Promise<T>,
  retryable: (error: unknown) => boolean,
  wait: (attempt: number) => number = defaultWait,
): Promise<T> {
  let attempt = 0
  while (true) {
    try {
      return await operation()
    } catch (error) {
      const delay = windows && retryable(error) ? wait(attempt) : 0
      if (delay <= 0) throw error
      attempt++
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

function defaultWait(attempt: number): number {
  const waits = [50, 100, 150, 250, 400, 600, 800]
  return waits[attempt] ?? 0
}
