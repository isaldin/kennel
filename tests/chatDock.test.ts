import { describe, expect, it } from 'vitest'
import {
  bindTerminal,
  chatId,
  clampWidth,
  openChat,
  unbindTerminal,
  visibleChat,
  type OpenChat
} from '../src/renderer/src/lib/chatDock'

const HOME = 'home'
const a = { serverId: 1, key: 'unknown:1:app', title: 'A' }
const b = { serverId: 1, key: 'disk_full:1:/', title: 'B' }

describe('chat dock', () => {
  it('opens each finding chat once and keeps earlier ones', () => {
    let list: OpenChat[] = []
    list = openChat(list, a)
    list = openChat(list, b)
    list = openChat(list, a)
    expect(list.map((c) => c.id)).toEqual([chatId(1, a.key), chatId(1, b.key)])
    expect(list.every((c) => c.terminalKey === null)).toBe(true)
  })

  it('shows the selected chat on the home tab and the bound chat on a terminal tab', () => {
    let list = openChat(openChat([], a), b)
    list = bindTerminal(list, chatId(1, a.key), 't1')
    expect(visibleChat(list, HOME, HOME, chatId(1, b.key))?.title).toBe('B')
    expect(visibleChat(list, 't1', HOME, chatId(1, b.key))?.title).toBe('A')
    expect(visibleChat(list, 't2', HOME, chatId(1, b.key))).toBeNull()
  })

  it('forgets the terminal when its tab closes, keeping the chat', () => {
    let list = bindTerminal(openChat([], a), chatId(1, a.key), 't1')
    list = unbindTerminal(list, 't1')
    expect(list).toHaveLength(1)
    expect(list[0].terminalKey).toBeNull()
  })

  it('keeps the chat width between a minimum and leaving room for the content', () => {
    expect(clampWidth(100, 1400)).toBe(320)
    expect(clampWidth(500, 1400)).toBe(500)
    expect(clampWidth(1300, 1400)).toBe(1000)
  })
})
