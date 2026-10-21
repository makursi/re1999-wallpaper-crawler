// ── The tag and package.json are one version (#88) ──────────────────
//
// The release is named by a tag, and the artifact inside is named by
// `package.json`. If the two disagree, the workflow would publish a zip whose
// status payload, its `app/package.json` and its own file name carry a number
// nobody tagged — so the disagreement is a refusal, not a warning.
//
// These tests hold the two rules the check has to keep:
//   - a release tag is exactly `vX.Y.Z` (semver, the ADR's discipline), and
//   - the number after `v` equals `package.json`'s version, character for
//     character, with both numbers named when it does not.

import { describe, expect, it } from 'vitest'

import { checkReleaseTag, tagVersion } from '../../scripts/release-tag.js'

describe('tagVersion', () => {
  it('reads the version out of a vX.Y.Z tag', () => {
    expect(tagVersion('v1.0.0')).toBe('1.0.0')
    expect(tagVersion('v0.0.0')).toBe('0.0.0')
    expect(tagVersion('v12.34.56')).toBe('12.34.56')
  })

  it('refuses anything that is not exactly vX.Y.Z', () => {
    // A prerelease is not a shape this repository releases yet; a missing `v`
    // means the tag push would not even trigger the workflow; a fourth number
    // is not semver. All of them would make the release's version ambiguous.
    for (const tag of [
      '1.0.0',
      'v1.0',
      'v1',
      'v1.0.0.0',
      'v1.0.0-rc.1',
      'v1.0.0+build',
      'release-v1.0.0',
      'v01.0.0',
      'v1.00.0',
      'v 1.0.0',
      ' v1.0.0',
      'v1.0.x',
      '',
    ]) {
      expect(tagVersion(tag)).toBeNull()
    }
  })
})

describe('checkReleaseTag', () => {
  it('accepts a tag that names the package.json version', () => {
    expect(checkReleaseTag('v1.0.0', '1.0.0')).toBe('1.0.0')
    expect(checkReleaseTag('v2.7.3', '2.7.3')).toBe('2.7.3')
  })

  it('refuses a disagreeing tag and names both numbers', () => {
    // The maintainer's likely mistake: bump package.json, forget one of the
    // three places, or tag the previous version. The message has to say which
    // number the tag claims and which one the package carries.
    expect(() => checkReleaseTag('v1.0.1', '1.0.0')).toThrow(/v1\.0\.1[\s\S]*1\.0\.0/)
    expect(() => checkReleaseTag('v2.0.0', '1.9.9')).toThrow(/v2\.0\.0[\s\S]*1\.9\.9/)
  })

  it('refuses a tag that is not vX.Y.Z instead of guessing a version', () => {
    expect(() => checkReleaseTag('1.0.0', '1.0.0')).toThrow(/vX\.Y\.Z/)
    expect(() => checkReleaseTag('v1.0', '1.0.0')).toThrow(/vX\.Y\.Z/)
  })
})
