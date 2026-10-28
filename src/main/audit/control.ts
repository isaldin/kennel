import { AUDIT_STOPPED } from '../../shared/audit'

/** Unanswered command requests are declined after this, so a night run can't block the queue. */
export const ANSWER_TIMEOUT_MS = 30 * 60_000

export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/** Thrown when the user stops a run or a chat answer. */
export class Stopped extends Error {
  constructor() {
    super(AUDIT_STOPPED)
  }
}

/** Rejects with `Stopped` as soon as the signal aborts, even if `promise` never settles. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Stopped())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Stopped())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      }
    )
  })
}

/** Work in progress that the user can stop and that may wait for command confirmation. */
export interface Controlled {
  controller: AbortController
  answer: ((approvedIds: string[]) => void) | null
}

/** Waits for `entry.answer` to be called; declines everything after `timeoutMs`. */
export function waitForAnswer(entry: Controlled, timeoutMs: number): Promise<string[]> {
  const answered = new Promise<string[]>((resolve) => {
    const timer = setTimeout(() => entry.answer?.([]), timeoutMs)
    entry.answer = (ids) => {
      clearTimeout(timer)
      entry.answer = null
      resolve(ids)
    }
  })
  return abortable(answered, entry.controller.signal)
}
