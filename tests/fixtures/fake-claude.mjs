#!/usr/bin/env node
// Stand-in for the Claude CLI in tests and smoke runs. Logs argv, stdin and cwd as one JSON line to
// FAKE_CLAUDE_LOG and prints FAKE_CLAUDE_REPLY (or the contents of FAKE_CLAUDE_REPLY_FILE),
// after FAKE_CLAUDE_DELAY_MS if set.
import { appendFileSync, readFileSync } from 'fs'

let stdin = ''
process.stdin.on('data', (d) => (stdin += d))
process.stdin.on('end', () => {
  const env = process.env
  if (env.FAKE_CLAUDE_LOG) {
    appendFileSync(
      env.FAKE_CLAUDE_LOG,
      JSON.stringify({ argv: process.argv.slice(2), stdin, cwd: process.cwd() }) + '\n'
    )
  }
  if (env.FAKE_CLAUDE_EXIT) {
    process.stderr.write('boom')
    process.exit(Number(env.FAKE_CLAUDE_EXIT))
  }
  const reply = env.FAKE_CLAUDE_REPLY ?? readFileSync(env.FAKE_CLAUDE_REPLY_FILE, 'utf8')
  setTimeout(() => process.stdout.write(reply), Number(env.FAKE_CLAUDE_DELAY_MS ?? 0))
})
