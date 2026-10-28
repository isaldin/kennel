import type { Decision, Finding, Snapshot } from '../../shared/audit'
import type { Server, Service } from '../../shared/types'
import type { RawCommandRequest } from './allowlist'
import {
  COMMAND_REQUESTS_SCHEMA,
  COMMANDS_HELP,
  invokeClaude,
  json,
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

export const CHAT_SYSTEM_PROMPT = `Ты помогаешь владельцу VPS разобраться с одной проблемой, которую нашёл аудит. Тебе дают находку, описание сервера, реестр его сервисов, свежий снимок сервера и прошлые решения пользователя. Дальше пользователь задаёт вопросы.

reply — твой ответ пользователю по-русски, кратко и по делу. Форматирование простое: абзацы, списки через «- », имена и пути в \`обратных кавычках\`, команды — блоками \`\`\`bash. Без заголовков (#) и без **жирного**: интерфейс их не отображает.

Сам ты не можешь ничего менять на сервере. Если пользователь хочет что-то сделать (остановить, удалить, обновить, перезапустить, закрыть порт), веди его ПО ОДНОМУ ШАГУ:
- в каждом ответе давай только одну команду (или один короткий блок из 2–3 строк, которые имеет смысл выполнить вместе) и коротко объясни, что она делает и что ожидаешь увидеть;
- попроси прислать вывод и дождись его; следующий шаг выбирай по фактическому результату, а не по предположению;
- не выписывай заранее весь план команд; при желании можно одной строкой назвать, сколько примерно шагов впереди;
- начинай с безопасной проверки, перед изменяющей командой предупреди о последствиях и скажи, как откатить.
Используй реальные имена контейнеров, юнитов, путей и доменов из снимка.

command_requests: если для ответа не хватает данных с сервера, попроси команды только для чтения. ${COMMANDS_HELP}
Не проси команды, если можно ответить по снимку. Когда просишь команды, в reply коротко скажи, что хочешь проверить.`

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
    '## Находка',
    json({ key, severity, title, explanation, suggestedQuestion, suggestedAction }),
    '## Сервер',
    json({
      id: i.server.id,
      name: i.server.name,
      provider: i.server.provider,
      project: i.server.project,
      monthlyCost: i.server.monthlyCost,
      currency: i.server.currency,
      notes: i.server.notes
    }),
    '## Реестр сервисов',
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
    '## Снимок',
    i.snapshot ? json(trimSnapshot(i.snapshot)) : 'Снимка нет.',
    '## Решения пользователя',
    json(i.decisions),
    '## Вопрос пользователя',
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
  }>({ ...call, schema: CHAT_SCHEMA, systemPrompt: CHAT_SYSTEM_PROMPT })
  return {
    sessionId,
    output: { reply: output.reply ?? '', commandRequests: output.command_requests ?? [] }
  }
}
