// ── The steering file's two pointers, and its budget (#134, #135) ───
//
// `AGENTS.md` is the file every turn loads first, so whatever it carries is paid
// for by every session. It is a map: a pointer names the document that holds the
// detail, and the annotated architecture — one line per module — lives in
// `docs/agents/architecture.md` rather than in the map itself (#134). The
// standards review's one source, `CODING_STANDARDS.md`, is named there for the
// same reason (#135).
//
// The budget is not a target: the map silently becomes a manual again, and only
// its length regrows, so no parser catches it. Its failure message states the
// disclosure rule, so a session that hits it knows where the material goes
// instead.
//
// The style guide's own pointer stays in `readme-styleguide.test.ts`: that
// file's subject is the guide, and this one's subject is the steering file.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const AGENTS_FILE = path.join(REPO_ROOT, 'AGENTS.md')
const ARCHITECTURE_FILE = path.join(REPO_ROOT, 'docs', 'agents', 'architecture.md')
const STANDARDS_FILE = path.join(REPO_ROOT, 'CODING_STANDARDS.md')

// A kilobyte is 1000 bytes here.
const STEERING_CEILING_BYTES = 24_000

/**
 * One pointer's two halves: `AGENTS.md` names the document, and the document it
 * names exists. A text-only assertion would pass on a link to nothing, so the
 * existence check is the other half.
 */
function pointerResolves(needle: string, file: string, message: string): void {
  const agents = fs.readFileSync(AGENTS_FILE, 'utf8')
  expect(agents, `AGENTS.md does not point at ${message}`).toContain(needle)
  expect(fs.existsSync(file), `${message} does not exist`).toBe(true)
}

describe('the steering document', () => {
  it('points at the annotated architecture, and the document exists', () => {
    // The tree is the authority the standards review cites for module ownership,
    // so it must stay reachable from the map even though it is no longer in it.
    pointerResolves('docs/agents/architecture.md', ARCHITECTURE_FILE, 'docs/agents/architecture.md')
  })

  it('points at the coding standards, and the document exists', () => {
    // The Standards axis of a review reads one document instead of a list the
    // parent rewrites each round; if the map does not name it, the axis has
    // nowhere to start.
    pointerResolves('CODING_STANDARDS.md', STANDARDS_FILE, 'CODING_STANDARDS.md')
  })

  it('stays inside its size budget', () => {
    const bytes = fs.statSync(AGENTS_FILE).size
    expect(
      bytes,
      `AGENTS.md is over its 24000-byte budget. It is a map, not a manual: it keeps
what a first command needs and points at the rest. Move the new material into the
document a pointer names — the annotated tree in docs/agents/architecture.md,
branch-specific lessons in docs/agents/branch-reference.md, the Run-log reading
in the runbook — and leave a pointer here.`,
    ).toBeLessThanOrEqual(STEERING_CEILING_BYTES)
  })
})
