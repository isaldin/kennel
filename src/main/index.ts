import { app, BrowserWindow, clipboard, ipcMain, Notification, shell } from 'electron'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import type { DecisionInput, Thresholds } from '../shared/audit'
import type { HostKeyPrompt, Server, ServerInput, ServiceInput } from '../shared/types'
import { resolveClaudeBin, runClaude, type ClaudeCall } from './audit/analyzer'
import { AuditRepo } from './audit/auditRepo'
import { AuditService, newAlertFindings } from './audit/auditService'
import { runChatClaude } from './audit/chat'
import { ChatRepo } from './audit/chatRepo'
import { ChatService } from './audit/chatService'
import { collect } from './audit/collect'
import { AuditScheduler } from './audit/scheduler'
import { openDb } from './db'
import { EnpassVault } from './enpass'
import { KnownHostsFile } from './knownHosts'
import { DB_FILE, LEGACY_NAME, migrateLegacyProfile } from './legacyProfile'
import { Repo } from './repo'
import { SSH_DIR, listAliases, resolveAlias } from './sshConfig'
import { execOnServer, type ExecResult } from './sshConnect'
import { SshSessions } from './sshSessions'

const CLIPBOARD_CLEAR_MS = 30_000

let mainWindow: BrowserWindow | null = null
const pendingHostKeys = new Map<string, (accept: boolean) => void>()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#14161a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function notify(title: string, body: string, serverId: number): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  n.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
    mainWindow?.webContents.send('audit:focus', serverId)
  })
  n.show()
}

function createAudit(
  repo: Repo,
  audit: AuditRepo,
  chats: ChatRepo,
  password: (server: Server) => string | null
): { service: AuditService; chat: ChatService } {
  const knownHosts = new KnownHostsFile(join(SSH_DIR, 'known_hosts'))
  const exec = (server: Server, command: string, stdin?: string): Promise<ExecResult> =>
    execOnServer(server, command, {
      policy: 'strict',
      knownHosts,
      password: password(server),
      stdin
    })
  let claudeBin: Promise<string> | null = null
  const bin = (): Promise<string> => {
    claudeBin ??= resolveClaudeBin().catch((err) => {
      claudeBin = null // retry next time, e.g. after the user installs the CLI
      throw err
    })
    return claudeBin
  }
  const call = async (
    prompt: string,
    resume: string | undefined,
    signal: AbortSignal | undefined
  ): Promise<ClaudeCall> => ({
    bin: await bin(),
    prompt,
    resume,
    signal,
    cwd: join(app.getPath('userData'), 'claude-sessions')
  })

  const chat = new ChatService({
    repo,
    audit,
    chats,
    exec: (server, command) => exec(server, command),
    claude: async (prompt, resume, signal) => runChatClaude(await call(prompt, resume, signal)),
    emit: (c) => mainWindow?.webContents.send('chat:update', c),
    now: () => new Date()
  })

  const service = new AuditService({
    repo,
    audit,
    collect: (server) => collect(server, (command, stdin) => exec(server, command, stdin)),
    exec: (server, command) => exec(server, command),
    claude: async (prompt, resume, signal) => runClaude(await call(prompt, resume, signal)),
    now: () => new Date(),
    emit: (run) => {
      mainWindow?.webContents.send('audit:update', run)
      if (run.serverId === null) return
      const name = repo.listServers().find((s) => s.id === run.serverId)?.name ?? ''
      if (run.status === 'awaiting_confirmation' && run.trigger === 'scheduled') {
        notify(`Kennel: ${name}`, 'Проверка ждёт подтверждения команд', run.serverId)
      }
      if (run.status === 'done') {
        const previous = audit.previousDone(run.serverId, run.id)
        const alerts = newAlertFindings(previous, run, audit.listDecisions(), new Date())
        if (alerts.length > 0) {
          notify(
            `Kennel: ${name}`,
            `${alerts.length} новых проблем: ${alerts[0].title}`,
            run.serverId
          )
        }
      }
    }
  })
  return { service, chat }
}

function registerAuditIpc(
  service: AuditService,
  chat: ChatService,
  audit: AuditRepo,
  chats: ChatRepo
): void {
  ipcMain.handle('chat:get', (_e, serverId: number, key: string) => chat.get(serverId, key))
  ipcMain.handle('chat:keys', (_e, serverId: number) => chats.keys(serverId))
  ipcMain.handle('chat:send', (_e, serverId: number, key: string, text: string) =>
    chat.send(serverId, key, text)
  )
  ipcMain.on('chat:stop', (_e, serverId: number, key: string) => chat.stop(serverId, key))
  ipcMain.on('chat:answerCommands', (_e, serverId: number, key: string, ids: string[]) =>
    chat.answerCommands(serverId, key, ids)
  )
  ipcMain.handle('audit:latest', (_e, serverId: number) => audit.latestRun(serverId))
  ipcMain.handle('audit:start', (_e, serverId: number) => service.start('manual', serverId))
  ipcMain.on('audit:stop', (_e, serverId: number) => service.stop(serverId))
  ipcMain.on('audit:answerCommands', (_e, runId: number, approvedIds: string[]) =>
    service.answerCommands(runId, approvedIds)
  )
  ipcMain.handle('audit:decide', (_e, key: string, input: DecisionInput) =>
    service.decide(key, input)
  )
  ipcMain.handle('audit:decisions', () => audit.listDecisions())
  ipcMain.handle('audit:thresholds', () => audit.getThresholds())
  ipcMain.handle('audit:setThresholds', (_e, t: Thresholds) => audit.setThresholds(t))
  ipcMain.handle('audit:autoAuditHours', () => audit.getAutoAuditHours())
  ipcMain.handle('audit:setAutoAuditHours', (_e, hours: number) => audit.setAutoAuditHours(hours))
  ipcMain.handle(
    'audit:snapshot',
    (_e, serverId: number) => audit.recentSnapshots(serverId, 1)[0] ?? null
  )
}

function registerIpc(repo: Repo, enpass: EnpassVault, ssh: SshSessions): void {
  ipcMain.handle('servers:list', () => repo.listServers())
  ipcMain.handle('servers:create', (_e, input: ServerInput) => repo.createServer(input))
  ipcMain.handle('servers:update', (_e, id: number, input: ServerInput) =>
    repo.updateServer(id, input)
  )
  ipcMain.handle('servers:remove', (_e, id: number) => repo.removeServer(id))

  ipcMain.handle('services:list', (_e, serverId?: number) => repo.listServices(serverId))
  ipcMain.handle('services:create', (_e, input: ServiceInput) => repo.createService(input))
  ipcMain.handle('services:update', (_e, id: number, input: ServiceInput) =>
    repo.updateService(id, input)
  )
  ipcMain.handle('services:remove', (_e, id: number) => repo.removeService(id))

  ipcMain.handle('sshConfig:hosts', () => {
    const imported = new Set(
      repo
        .listServers()
        .map((s) => s.sshAlias)
        .filter(Boolean)
    )
    return listAliases().map((alias) => {
      const r = resolveAlias(alias)
      return {
        alias,
        hostName: r.hostName,
        user: r.user,
        port: r.port,
        identityFile: r.identityFiles[0] ?? '',
        alreadyImported: imported.has(alias)
      }
    })
  })
  ipcMain.handle('sshConfig:import', (_e, aliases: string[]) =>
    aliases.map((alias) =>
      repo.createServer({
        name: alias,
        provider: '',
        host: '',
        port: 22,
        username: '',
        sshAlias: alias,
        identityFile: '',
        enpassItemUuid: '',
        monthlyCost: 0,
        currency: 'USD',
        billingDay: null,
        project: '',
        panelUrl: '',
        notes: ''
      })
    )
  )

  ipcMain.handle('enpass:status', () => enpass.status())
  ipcMain.handle('enpass:unlock', (_e, password: string) => enpass.unlock(password))
  ipcMain.handle('enpass:lock', () => enpass.lock())
  ipcMain.handle('enpass:search', (_e, query: string) => enpass.search(query))
  ipcMain.handle('enpass:get', (_e, uuid: string) => enpass.get(uuid))
  ipcMain.handle('enpass:copyPassword', (_e, uuid: string) => {
    const secret = enpass.password(uuid)
    clipboard.writeText(secret)
    setTimeout(async () => {
      if ((await clipboard.readText()) === secret) clipboard.clear()
    }, CLIPBOARD_CLEAR_MS)
  })

  ipcMain.handle('ssh:open', (_e, serverId: number, cols: number, rows: number) =>
    ssh.open(repo.getServer(serverId), cols, rows)
  )
  ipcMain.on('ssh:write', (_e, sessionId: string, data: string) => ssh.write(sessionId, data))
  ipcMain.on('ssh:resize', (_e, sessionId: string, cols: number, rows: number) =>
    ssh.resize(sessionId, cols, rows)
  )
  ipcMain.on('ssh:close', (_e, sessionId: string) => ssh.close(sessionId))
  ipcMain.on('ssh:hostKeyAnswer', (_e, promptId: string, accept: boolean) => {
    pendingHostKeys.get(promptId)?.(accept)
    pendingHostKeys.delete(promptId)
  })

  ipcMain.on('openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })
}

// Lets automated runs use a throwaway profile instead of the real database.
if (process.env.KENNEL_USER_DATA) app.setPath('userData', process.env.KENNEL_USER_DATA)
else {
  try {
    migrateLegacyProfile({
      from: join(app.getPath('appData'), LEGACY_NAME),
      to: app.getPath('userData'),
      claudeProjects: join(homedir(), '.claude', 'projects')
    })
  } catch (err) {
    // The old profile stays where it was, so nothing is lost; the app starts empty.
    console.error('Could not move the pre-rename profile:', err)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('dev.kennel')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const db = openDb(join(app.getPath('userData'), DB_FILE))
  const repo = new Repo(db)
  const auditRepo = new AuditRepo(db)
  auditRepo.failInterrupted(new Date().toISOString())
  const enpass = new EnpassVault()
  const password = (server: Server): string | null =>
    server.enpassItemUuid && enpass.status().unlocked
      ? enpass.password(server.enpassItemUuid)
      : null
  const ssh = new SshSessions({
    emit: (event) => mainWindow?.webContents.send('ssh:event', event),
    askHostKey: (prompt) =>
      new Promise<boolean>((resolve) => {
        if (!mainWindow) return resolve(false)
        const full: HostKeyPrompt = { ...prompt, promptId: randomUUID() }
        pendingHostKeys.set(full.promptId, resolve)
        mainWindow.webContents.send('ssh:hostKeyPrompt', full)
      }),
    password
  })
  registerIpc(repo, enpass, ssh)

  const chatRepo = new ChatRepo(db)
  chatRepo.failInterrupted()
  const { service: audit, chat } = createAudit(repo, auditRepo, chatRepo, (server) => {
    try {
      return password(server)
    } catch {
      return null
    }
  })
  registerAuditIpc(audit, chat, auditRepo, chatRepo)
  const scheduler = new AuditScheduler({
    serverIds: () => repo.listServers().map((s) => s.id),
    lastRunAt: (serverId) => auditRepo.latestRun(serverId)?.startedAt ?? null,
    isRunning: () => audit.isRunning(),
    start: (serverId) => audit.start('scheduled', serverId),
    periodMs: () => auditRepo.getAutoAuditHours() * 3_600_000 || null
  })

  app.on('before-quit', () => {
    scheduler.stop()
    for (const server of repo.listServers()) audit.stop(server.id)
    chat.stopAll()
    ssh.closeAll()
    enpass.lock()
  })

  createWindow()
  scheduler.startTimer()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
