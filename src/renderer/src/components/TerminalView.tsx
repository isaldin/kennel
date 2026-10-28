import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { usePrefs } from '../lib/prefsContext'
import { subscribeSession } from '../lib/sessionHub'

interface Props {
  serverId: number
  active: boolean
  onStatus(status: 'connecting' | 'connected' | 'closed'): void
}

export function TerminalView({ serverId, active, onStatus }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const onStatusRef = useRef(onStatus)
  const { prefs, theme, t } = usePrefs()
  const tRef = useRef(t)
  const lookRef = useRef({ prefs, theme })
  useEffect(() => {
    onStatusRef.current = onStatus
    tRef.current = t
  })

  useEffect(() => {
    const look = lookRef.current
    const term = new Terminal({
      fontFamily: look.prefs.termFontFamily,
      fontSize: look.prefs.termFontSize,
      cursorBlink: look.prefs.cursorBlink,
      scrollback: 20000,
      macOptionIsMeta: true,
      theme: look.theme.terminal
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current!)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    let sessionId: string | null = null
    let unsubscribe = (): void => {}
    let disposed = false
    onStatusRef.current('connecting')

    window.api.ssh.open(serverId, term.cols, term.rows).then(
      (id) => {
        if (disposed) {
          window.api.ssh.close(id)
          return
        }
        sessionId = id
        unsubscribe = subscribeSession(id, (event) => {
          if (event.type === 'data' && event.data) term.write(event.data)
          else if (event.type === 'status') {
            term.write(`\x1b[2m${event.message}\x1b[0m\r\n`)
            if (event.message === 'Connected') onStatusRef.current('connected')
          } else if (event.type === 'error') term.write(`\r\n\x1b[31m${event.message}\x1b[0m\r\n`)
          else if (event.type === 'closed') {
            term.write(`\r\n\x1b[2m[${tRef.current('common.connectionClosed')}]\x1b[0m\r\n`)
            onStatusRef.current('closed')
          }
        })
      },
      (err: Error) => {
        term.write(`\x1b[31m${err.message}\x1b[0m\r\n`)
        onStatusRef.current('closed')
      }
    )

    const dataSub = term.onData((data) => sessionId && window.api.ssh.write(sessionId, data))
    const resizeSub = term.onResize(
      ({ cols, rows }) => sessionId && window.api.ssh.resize(sessionId, cols, rows)
    )
    const observer = new ResizeObserver(() => {
      if (containerRef.current?.offsetParent) fit.fit()
    })
    observer.observe(containerRef.current!)

    return () => {
      disposed = true
      observer.disconnect()
      dataSub.dispose()
      resizeSub.dispose()
      unsubscribe()
      if (sessionId) window.api.ssh.close(sessionId)
      term.dispose()
    }
  }, [serverId])

  // Settings changes apply to open terminals without reconnecting.
  useEffect(() => {
    lookRef.current = { prefs, theme }
    const term = termRef.current
    if (!term) return
    term.options.theme = theme.terminal
    term.options.fontFamily = prefs.termFontFamily
    term.options.fontSize = prefs.termFontSize
    term.options.cursorBlink = prefs.cursorBlink
    if (containerRef.current?.offsetParent) fitRef.current?.fit()
  }, [prefs, theme])

  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      fitRef.current?.fit()
      termRef.current?.focus()
    })
  }, [active])

  return (
    <div
      className="term-pane"
      ref={containerRef}
      style={{ display: active ? 'block' : 'none', background: theme.terminal.background }}
    />
  )
}
