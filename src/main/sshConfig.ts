import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import SSHConfig, { LineType, type Section } from 'ssh-config'

export const SSH_DIR = join(homedir(), '.ssh')
const CONFIG_PATH = join(SSH_DIR, 'config')

export interface ResolvedHost {
  hostName: string
  user: string
  port: number
  identityFiles: string[]
}

function load(): SSHConfig {
  try {
    return SSHConfig.parse(readFileSync(CONFIG_PATH, 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return SSHConfig.parse('')
    throw err
  }
}

export function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

const asList = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v]

/** Concrete (non-wildcard) Host aliases declared in ~/.ssh/config. */
export function listAliases(): string[] {
  const aliases: string[] = []
  for (const line of load()) {
    if (line.type !== LineType.DIRECTIVE || line.param.toLowerCase() !== 'host') continue
    const values =
      typeof (line as Section).value === 'string'
        ? [(line as Section).value as string]
        : ((line as Section).value as { val: string }[]).map((v) => v.val)
    for (const value of values) {
      for (const alias of value.split(/\s+/)) {
        if (alias && !/[*?!]/.test(alias)) aliases.push(alias)
      }
    }
  }
  return [...new Set(aliases)]
}

/** Resolves an alias the way `ssh <alias>` would (Host blocks only; Match exec is not evaluated). */
export function resolveAlias(alias: string): ResolvedHost {
  const computed = load().compute(alias)
  const first = (key: string): string => asList(computed[key])[0] ?? ''
  return {
    hostName: first('HostName') || alias,
    user: first('User'),
    port: Number(first('Port')) || 22,
    identityFiles: asList(computed['IdentityFile']).map(expandHome)
  }
}
