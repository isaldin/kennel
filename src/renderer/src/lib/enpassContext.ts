import { createContext, useContext } from 'react'
import type { EnpassStatus } from '../../../shared/types'

export interface EnpassContextValue {
  status: EnpassStatus
  /** Resolves true once the vault is unlocked (prompting if needed). */
  ensureUnlocked(): Promise<boolean>
  lock(): Promise<void>
}

export const EnpassContext = createContext<EnpassContextValue | null>(null)

export function useEnpass(): EnpassContextValue {
  const ctx = useContext(EnpassContext)
  if (!ctx) throw new Error('EnpassProvider missing')
  return ctx
}
