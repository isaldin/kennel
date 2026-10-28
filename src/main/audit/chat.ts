import type { Decision, Finding, Snapshot } from '../../shared/audit'
import type { Server, Service } from '../../shared/types'
import { getLang } from '../i18n'
import type { RawCommandRequest } from './allowlist'
import {
  COMMAND_REQUESTS_SCHEMA,
  COMMANDS_HELP,
  invokeClaude,
  json,
  replyLanguageNote,
  trimSnapshot,
  type ClaudeCall
} from './analyzer'

export const CHAT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'command_requests'],
  properties: {
    reply: { type: 'string' },
    command_requests: COMMAND_REQUESTS_SCHEMA
  }
}

export const CHAT_SYSTEM_PROMPT = `You help a VPS owner deal with one problem the audit found. You get the finding, the server's description, its service registry, a fresh snapshot of the server and the user's past decisions. Then the user asks questions.

reply is your answer to the user, brief and to the point. Keep formatting simple: paragraphs, lists with "- ", names and paths in \`backticks\`, commands in \`\`\`bash blocks. No headings (#) and no **bold**: the interface does not render them.

You cannot change anything on the server yourself. If the user wants to do something (stop, remove, update, restart, close a port), guide them ONE STEP AT A TIME:
- give only one command per answer (or one short block of 2–3 lines that make sense to run together), and briefly explain what it does and what you expect to see;
- ask them to send the output and wait for it; pick the next step from the actual result, not from a guess;
- do not write out the whole plan of commands up front; you may say in one line roughly how many steps are left;
- start with a safe check; before a command that changes something, warn about the consequences and say how to roll back.
Use the real container, unit, path and domain names from the snapshot.

command_requests: if you lack data from the server to answer, ask for read-only commands. ${COMMANDS_HELP}
Do not ask for commands if the snapshot is enough. When you ask for commands, say briefly in reply what you want to check.`

export function buildChatPrompt(i: {
  server: Server
  services: Service[]
  snapshot: Snapshot | null
  finding: Finding
  decisions: Decision[]
  question: string
}): string {
  const { key, severity, title, explanation, suggestedQuestion, suggestedAction } = i.finding
  return [
    '## Finding',
    json({ key, severity, title, explanation, suggestedQuestion, suggestedAction }),
    '## Server',
    json({
      id: i.server.id,
      name: i.server.name,
      provider: i.server.provider,
      project: i.server.project,
      monthlyCost: i.server.monthlyCost,
      currency: i.server.currency,
      notes: i.server.notes
    }),
    '## Service registry',
    json(
      i.services.map(({ name, kind, url, port, description, expected, notes }) => ({
        name,
        kind,
        url,
        port,
        description,
        expected,
        notes
      }))
    ),
    '## Snapshot',
    i.snapshot ? json(trimSnapshot(i.snapshot)) : 'No snapshot.',
    '## User decisions',
    json(i.decisions),
    '## User question',
    i.question
  ].join('\n\n')
}

export interface ChatReply {
  sessionId: string
  output: { reply: string; commandRequests: RawCommandRequest[] }
}

export async function runChatClaude(call: ClaudeCall): Promise<ChatReply> {
  const { sessionId, output } = await invokeClaude<{
    reply: string
    command_requests: RawCommandRequest[]
  }>({
    ...call,
    schema: CHAT_SCHEMA,
    systemPrompt: `${CHAT_SYSTEM_PROMPT}\n\n${replyLanguageNote(getLang())}`
  })
  return {
    sessionId,
    output: { reply: output.reply ?? '', commandRequests: output.command_requests ?? [] }
  }
}
