// ── The README style guide is reachable from the steering file (#128) ─
//
// `AGENTS.md` is the file every turn loads first, so a guide nothing points at
// is a guide the next edit never reads. The guide exists in `docs/`, and the
// steering file names it; a text-only assertion would pass on a link to
// nothing, so the existence check is the other half.
//
// The subject is a committed document rather than source, so this file keeps
// the document's own name and lives beside the ADR index test.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const AGENTS_FILE = path.join(REPO_ROOT, 'AGENTS.md')
const STYLEGUIDE_FILE = path.join(REPO_ROOT, 'docs', 'readme-styleguide.md')

describe('the README style guide', () => {
  it('exists, and the steering file points at it', () => {
    // The guide holds the standard a README edit is held to, so the pointer
    // lives in the first file a session opens; the path is the assertion, and
    // the existence check is the other half of the pointer.
    expect(fs.existsSync(STYLEGUIDE_FILE), 'docs/readme-styleguide.md does not exist').toBe(true)
    const agents = fs.readFileSync(AGENTS_FILE, 'utf8')
    expect(agents, 'AGENTS.md does not point at docs/readme-styleguide.md').toContain(
      'docs/readme-styleguide.md',
    )
  })
})
