import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { claudeProjectDir, migrateLegacyProfile } from '../src/main/legacyProfile'

function setup(): { from: string; to: string; claudeProjects: string } {
  const root = mkdtempSync(join(tmpdir(), 'kennel-legacy-'))
  return {
    from: join(root, 'app', 'opentermius'),
    to: join(root, 'app', 'kennel'),
    claudeProjects: join(root, 'claude-projects')
  }
}

describe('claudeProjectDir', () => {
  it('escapes the cwd like Claude CLI does', () => {
    expect(
      claudeProjectDir('/p', '/Users/me/Library/Application Support/opentermius/claude-sessions')
    ).toBe('/p/-Users-me-Library-Application-Support-opentermius-claude-sessions')
  })
})

describe('migrateLegacyProfile', () => {
  it('moves the profile, renames the database and the Claude session folder', () => {
    const p = setup()
    mkdirSync(join(p.from, 'Local Storage'), { recursive: true })
    writeFileSync(join(p.from, 'opentermius.db'), 'db')
    writeFileSync(join(p.from, 'opentermius.db-wal'), 'wal')
    const oldSessions = claudeProjectDir(p.claudeProjects, join(p.from, 'claude-sessions'))
    mkdirSync(oldSessions, { recursive: true })
    writeFileSync(join(oldSessions, 's.jsonl'), 'session')

    expect(migrateLegacyProfile(p)).toBe(true)

    expect(existsSync(p.from)).toBe(false)
    expect(readFileSync(join(p.to, 'kennel.db'), 'utf8')).toBe('db')
    expect(readFileSync(join(p.to, 'kennel.db-wal'), 'utf8')).toBe('wal')
    expect(existsSync(join(p.to, 'Local Storage'))).toBe(true)
    const newSessions = claudeProjectDir(p.claudeProjects, join(p.to, 'claude-sessions'))
    expect(readFileSync(join(newSessions, 's.jsonl'), 'utf8')).toBe('session')
  })

  it('migrates into the empty userData folder Electron creates before main runs', () => {
    const p = setup()
    mkdirSync(p.from, { recursive: true })
    mkdirSync(p.to, { recursive: true })
    writeFileSync(join(p.from, 'opentermius.db'), 'db')

    expect(migrateLegacyProfile(p)).toBe(true)
    expect(existsSync(p.from)).toBe(false)
    expect(readFileSync(join(p.to, 'kennel.db'), 'utf8')).toBe('db')
  })

  it('leaves a new profile with content alone', () => {
    const p = setup()
    mkdirSync(p.from, { recursive: true })
    mkdirSync(p.to, { recursive: true })
    writeFileSync(join(p.to, 'kennel.db'), 'new')
    writeFileSync(join(p.from, 'opentermius.db'), 'old')

    expect(migrateLegacyProfile(p)).toBe(false)
    expect(existsSync(join(p.from, 'opentermius.db'))).toBe(true)
    expect(readFileSync(join(p.to, 'kennel.db'), 'utf8')).toBe('new')
  })

  it('does nothing without an old profile', () => {
    const p = setup()
    expect(migrateLegacyProfile(p)).toBe(false)
    expect(existsSync(p.to)).toBe(false)
  })
})
