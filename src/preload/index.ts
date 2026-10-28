import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { AuditRun, FindingChat } from '../shared/audit'
import type { Api, HostKeyPrompt, SessionEvent } from '../shared/types'

const api: Api = {
  servers: {
    list: () => ipcRenderer.invoke('servers:list'),
    create: (input) => ipcRenderer.invoke('servers:create', input),
    update: (id, input) => ipcRenderer.invoke('servers:update', id, input),
    remove: (id) => ipcRenderer.invoke('servers:remove', id)
  },
  services: {
    list: (serverId) => ipcRenderer.invoke('services:list', serverId),
    create: (input) => ipcRenderer.invoke('services:create', input),
    update: (id, input) => ipcRenderer.invoke('services:update', id, input),
    remove: (id) => ipcRenderer.invoke('services:remove', id)
  },
  sshConfig: {
    hosts: () => ipcRenderer.invoke('sshConfig:hosts'),
    importHosts: (aliases) => ipcRenderer.invoke('sshConfig:import', aliases)
  },
  enpass: {
    status: () => ipcRenderer.invoke('enpass:status'),
    unlock: (password) => ipcRenderer.invoke('enpass:unlock', password),
    lock: () => ipcRenderer.invoke('enpass:lock'),
    search: (query) => ipcRenderer.invoke('enpass:search', query),
    get: (uuid) => ipcRenderer.invoke('enpass:get', uuid),
    copyPassword: (uuid) => ipcRenderer.invoke('enpass:copyPassword', uuid)
  },
  ssh: {
    open: (serverId, cols, rows) => ipcRenderer.invoke('ssh:open', serverId, cols, rows),
    write: (sessionId, data) => ipcRenderer.send('ssh:write', sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.send('ssh:resize', sessionId, cols, rows),
    close: (sessionId) => ipcRenderer.send('ssh:close', sessionId),
    answerHostKey: (promptId, accept) => ipcRenderer.send('ssh:hostKeyAnswer', promptId, accept),
    onEvent: (listener) => {
      const handler = (_: unknown, event: SessionEvent): void => listener(event)
      ipcRenderer.on('ssh:event', handler)
      return () => ipcRenderer.removeListener('ssh:event', handler)
    },
    onHostKeyPrompt: (listener) => {
      const handler = (_: unknown, prompt: HostKeyPrompt): void => listener(prompt)
      ipcRenderer.on('ssh:hostKeyPrompt', handler)
      return () => ipcRenderer.removeListener('ssh:hostKeyPrompt', handler)
    }
  },
  audit: {
    latest: (serverId) => ipcRenderer.invoke('audit:latest', serverId),
    start: (serverId) => ipcRenderer.invoke('audit:start', serverId),
    stop: (serverId) => ipcRenderer.send('audit:stop', serverId),
    answerCommands: (runId, approvedIds) =>
      ipcRenderer.send('audit:answerCommands', runId, approvedIds),
    decide: (key, input) => ipcRenderer.invoke('audit:decide', key, input),
    decisions: () => ipcRenderer.invoke('audit:decisions'),
    thresholds: () => ipcRenderer.invoke('audit:thresholds'),
    setThresholds: (t) => ipcRenderer.invoke('audit:setThresholds', t),
    autoAuditHours: () => ipcRenderer.invoke('audit:autoAuditHours'),
    setAutoAuditHours: (hours) => ipcRenderer.invoke('audit:setAutoAuditHours', hours),
    snapshot: (serverId) => ipcRenderer.invoke('audit:snapshot', serverId),
    onUpdate: (listener) => {
      const handler = (_: unknown, run: AuditRun): void => listener(run)
      ipcRenderer.on('audit:update', handler)
      return () => ipcRenderer.removeListener('audit:update', handler)
    },
    onFocus: (listener) => {
      const handler = (_: unknown, serverId: number): void => listener(serverId)
      ipcRenderer.on('audit:focus', handler)
      return () => ipcRenderer.removeListener('audit:focus', handler)
    }
  },
  chat: {
    get: (serverId, key) => ipcRenderer.invoke('chat:get', serverId, key),
    keys: (serverId) => ipcRenderer.invoke('chat:keys', serverId),
    send: (serverId, key, text) => ipcRenderer.invoke('chat:send', serverId, key, text),
    stop: (serverId, key) => ipcRenderer.send('chat:stop', serverId, key),
    answerCommands: (serverId, key, ids) =>
      ipcRenderer.send('chat:answerCommands', serverId, key, ids),
    onUpdate: (listener) => {
      const handler = (_: unknown, chat: FindingChat): void => listener(chat)
      ipcRenderer.on('chat:update', handler)
      return () => ipcRenderer.removeListener('chat:update', handler)
    }
  },
  setZoom: (factor) => webFrame.setZoomFactor(factor),
  openExternal: (url) => ipcRenderer.send('openExternal', url)
}

contextBridge.exposeInMainWorld('api', api)
