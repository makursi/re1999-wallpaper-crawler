// ── The README style guide is reachable from the steering file (#125) ─
//
// `docs/readme-styleguide.md` is the standard a product-document change is
// held to, and a guide nothing links is a guide the next edit never reads. The
// steering document — the first file a session opens — carries the pointer, so
// a session about to edit `README.md` or `README.en.md` finds the standard.
//
// The check has two halves: the pointer in `AGENTS.md`, and the file the
// pointer names. A text-only assertion would pass on a link to nothing, so the
// existence check is the other half.
//
// The subject is committed documents rather than source, so this file keeps
// the document's own name and lives beside the ADR index test.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const AGENTS_FILE = path.join(REPO_ROOT, 'AGENTS.md')
const STYLEGUIDE_FILE = path.join(REPO_ROOT, 'docs', 'readme-styleguide.md')

describe('the README style guide', () => {
  it('is committed, and the steering document points at it', () => {
    // A guide nothing links is a guide the next edit never reads. The steering
    // document is the first file a session opens, so the pointer lives there;
    // the path is the assertion, and the existence check is the other half of
    // the pointer: a link to nothing would pass a text-only assertion.
    const agents = fs.readFileSync(AGENTS_FILE, 'utf8')
    expect(agents, 'AGENTS.md does not point at docs/readme-styleguide.md').toContain(
      'docs/readme-styleguide.md',
    )
    expect(fs.existsSync(STYLEGUIDE_FILE), 'docs/readme-styleguide.md does not exist').toBe(true)
  })
})
