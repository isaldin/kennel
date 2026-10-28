import type { Server, ServerInput, ServiceInput } from '../../../shared/types'

export const EMPTY_SERVER: ServerInput = {
  name: '',
  provider: '',
  host: '',
  port: 22,
  username: 'root',
  sshAlias: '',
  identityFile: '',
  enpassItemUuid: '',
  monthlyCost: 0,
  currency: 'USD',
  billingDay: null,
  project: '',
  panelUrl: '',
  notes: ''
}

export function toInput(server: Server): ServerInput {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, createdAt, updatedAt, ...input } = server
  return input
}

export function emptyService(serverId: number): ServiceInput {
  return {
    serverId,
    name: '',
    kind: 'docker',
    url: '',
    port: null,
    description: '',
    enpassItemUuid: '',
    expected: true,
    notes: ''
  }
}
