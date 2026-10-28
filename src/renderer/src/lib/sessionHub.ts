import type { SessionEvent } from '../../../shared/types'

type Listener = (event: SessionEvent) => void

/**
 * Main can emit events for a session before `ssh.open()` resolves with its id,
 * so events for not-yet-subscribed sessions are buffered and replayed.
 */
const listeners = new Map<string, Listener>()
const buffered = new Map<string, SessionEvent[]>()

window.api.ssh.onEvent((event) => {
  const listener = listeners.get(event.sessionId)
  if (listener) {
    listener(event)
    return
  }
  const queue = buffered.get(event.sessionId) ?? []
  queue.push(event)
  buffered.set(event.sessionId, queue)
})

export function subscribeSession(sessionId: string, listener: Listener): () => void {
  listeners.set(sessionId, listener)
  for (const event of buffered.get(sessionId) ?? []) listener(event)
  buffered.delete(sessionId)
  return () => listeners.delete(sessionId)
}
