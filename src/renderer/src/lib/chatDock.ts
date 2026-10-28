/** A finding chat open in the right-hand column, optionally tied to a terminal tab. */
export interface OpenChat {
  id: string
  serverId: number
  key: string
  title: string
  /** The terminal tab opened from this chat; the chat shows next to it. */
  terminalKey: string | null
}

export const CHAT_MIN_WIDTH = 320
/** Room left for the server page or terminal next to the chat. */
const CONTENT_MIN_WIDTH = 400

export const chatId = (serverId: number, key: string): string => `${serverId}:${key}`

export function openChat(
  list: OpenChat[],
  c: { serverId: number; key: string; title: string }
): OpenChat[] {
  const id = chatId(c.serverId, c.key)
  return list.some((x) => x.id === id) ? list : [...list, { ...c, id, terminalKey: null }]
}

export function bindTerminal(list: OpenChat[], id: string, terminalKey: string): OpenChat[] {
  return list.map((c) => (c.id === id ? { ...c, terminalKey } : c))
}

export function unbindTerminal(list: OpenChat[], terminalKey: string): OpenChat[] {
  return list.map((c) => (c.terminalKey === terminalKey ? { ...c, terminalKey: null } : c))
}

/** Home tab: the chat picked there. Terminal tab: the chat that opened it, if any. */
export function visibleChat(
  list: OpenChat[],
  activeTab: string,
  homeTab: string,
  homeChatId: string | null
): OpenChat | null {
  if (activeTab === homeTab) return list.find((c) => c.id === homeChatId) ?? null
  return list.find((c) => c.terminalKey === activeTab) ?? null
}

export function clampWidth(width: number, windowWidth: number): number {
  return Math.round(
    Math.min(
      Math.max(width, CHAT_MIN_WIDTH),
      Math.max(CHAT_MIN_WIDTH, windowWidth - CONTENT_MIN_WIDTH)
    )
  )
}
