import { describe, expect, it } from 'vitest'

import { mergeDappMetadata } from '../src/utils/bex/metadata'

const page = {
  name: 'Page title',
  description: 'Page description',
  icons: ['https://example.com/favicon.png'],
}

describe('mergeDappMetadata', () => {
  it('takes everything from the page when the dApp declares nothing', () => {
    expect(mergeDappMetadata(undefined, page)).toEqual(page)
  })

  it('keeps the declared fields and fills the rest from the page', () => {
    expect(mergeDappMetadata({ name: 'Declared', description: 'Its description' }, page)).toEqual({
      name: 'Declared',
      description: 'Its description',
      icons: page.icons,
    })
  })

  it("takes the dApp's icon ahead of the page's favicon", () => {
    expect(mergeDappMetadata({ icons: ['https://example.com/icon.png'] }, page)).toEqual({
      name: page.name,
      description: page.description,
      icons: ['https://example.com/icon.png'],
    })
  })

  it('falls back to the page icon when the declared one cannot be loaded', () => {
    expect(mergeDappMetadata({ name: 'Declared', icons: ['ftp://example.com/icon.png'] }, page)).toEqual({
      name: 'Declared',
      description: page.description,
      icons: page.icons,
    })
  })

  it("takes WizardConnect's singular icon and ignores empty fields", () => {
    expect(mergeDappMetadata({ name: '  ', description: '', icon: 'https://example.com/icon.png' }, page)).toEqual({
      name: page.name,
      description: page.description,
      icons: ['https://example.com/icon.png'],
    })
  })
})
