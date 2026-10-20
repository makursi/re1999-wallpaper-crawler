import { describe, expect, it } from 'vitest'

import { withToken } from '../../../../web/src/lib/console-api.js'

describe('withToken', () => {
  it('appends the token as the first query parameter', () => {
    expect(withToken('/api/status', 'abc')).toBe('/api/status?token=abc')
  })

  it('uses & when the path already carries a query', () => {
    expect(withToken('/api/gallery?v=2', 'abc')).toBe('/api/gallery?v=2&token=abc')
  })

  it('encodes a token that needs it', () => {
    expect(withToken('/api/status', 'a b&c')).toBe('/api/status?token=a%20b%26c')
  })

  it('leaves the path alone when this page was opened with no token', () => {
    // An empty token is refused by the guard either way; `?token=` would only
    // make a request that cannot succeed look deliberate.
    expect(withToken('/api/status', '')).toBe('/api/status')
  })
})
