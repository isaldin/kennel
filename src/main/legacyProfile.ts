import { existsSync, readdirSync, renameSync, rmdirSync } from 'fs'
import { join } from 'path'

export const LEGACY_NAME = 'opentermius'
export const DB_FILE = 'kennel.db'
const DB_SUFFIXES = ['', '-wal', '-shm', '-journal']

/** Claude CLI keeps a session under ~/.claude/projects/<cwd with every non-alphanumeric char as '-'>. */
export function claudeProjectDir(projectsDir: string, cwd: string): string {
  return join(projectsDir, cwd.replace(/[^a-zA-Z0-9]/g, '-'))
}

export interface LegacyProfilePaths {
  /** The profile folder the app used before the rename to Kennel. */
  from: string
  /** The current userData folder. */
  to: string
  /** ~/.claude/projects, so finding chats can still `--resume` from the moved cwd. */
  claudeProjects: string
}

/**
 * Moves the pre-rename profile into place once: the database (renamed to kennel.db),
 * localStorage prefs and the Claude session folder. Does nothing if the new profile
 * already has content. Electron creates an empty userData folder before main runs, so an
 * empty one counts as missing. Returns whether a migration happened.
 */
export function migrateLegacyProfile(p: LegacyProfilePaths): boolean {
  if (!existsSync(p.from)) return false
  if (existsSync(p.to)) {
    if (readdirSync(p.to).length > 0) return false
    rmdirSync(p.to)
  }
  renameSync(p.from, p.to)
  for (const suffix of DB_SUFFIXES) {
    const old = join(p.to, `${LEGACY_NAME}.db${suffix}`)
    if (existsSync(old)) renameSync(old, join(p.to, `${DB_FILE}${suffix}`))
  }
  const oldSessions = claudeProjectDir(p.claudeProjects, join(p.from, 'claude-sessions'))
  const newSessions = claudeProjectDir(p.claudeProjects, join(p.to, 'claude-sessions'))
  if (existsSync(oldSessions) && !existsSync(newSessions)) renameSync(oldSessions, newSessions)
  return true
}
