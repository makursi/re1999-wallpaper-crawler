import { describe, expect, it } from 'vitest'

import { shouldPoll } from '../../../../web/src/lib/poll.js'

describe('shouldPoll', () => {
  it('keeps reading while a Run is in flight', () => {
    expect(shouldPoll('running')).toBe(true)
  })

  it('stops reading an idle Console', () => {
    expect(shouldPoll('idle')).toBe(false)
  })

  it('stops reading an Orphaned Run, which only a person can change', () => {
    expect(shouldPoll('orphaned')).toBe(false)
  })

  it('does not read before the first read has said anything', () => {
    expect(shouldPoll(null)).toBe(false)
    expect(shouldPoll(undefined)).toBe(false)
  })
})
