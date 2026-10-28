/** A message: plain text, or plural forms picked by the `count` param (Intl.PluralRules categories). */
export type Message = string | Plural

export interface Plural {
  one: string
  few?: string
  many?: string
  other: string
}

export type Dict = Record<string, Message>

/** A translation of `D`: every key of `D`, no extra keys. */
export type Translation<D extends Dict> = { [K in keyof D]: Message }
