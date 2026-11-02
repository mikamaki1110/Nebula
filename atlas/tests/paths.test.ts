import { describe, expect, it } from 'vitest'
import { assertValidName } from '../src/main/core/paths'

describe('assertValidName', () => {
  it('akzeptiert normale Namen', () => {
    expect(assertValidName('Urlaub 2024.jpg')).toBe('Urlaub 2024.jpg')
    expect(assertValidName('  Bericht  ')).toBe('Bericht')
  })
  it('lehnt Pfadtrenner und Windows-Sonderzeichen ab', () => {
    for (const bad of ['a/b', 'a\\b', 'x:y', 'frage?', 'stern*', '..', '.', 'endet.', '']) {
      expect(() => assertValidName(bad)).toThrow()
    }
  })
  it('lehnt reservierte Windows-Namen ab', () => {
    for (const bad of ['CON', 'nul.txt', 'COM1', 'lpt9.log']) expect(() => assertValidName(bad)).toThrow()
  })
})
