// ── The steering file's pointers, and its budget (#134) ─────────────
//
// `AGENTS.md` is the file every turn loads first, so whatever it carries is paid
// for by every session. It is a map: a pointer names the document that holds the
// detail, and the annotated architecture — one line per module — lives in
// `docs/agents/architecture.md` rather than in the map itself (#134).
//
// Every reachability check has two halves: the pointer in `AGENTS.md`, and the
// file the pointer names. A text-only assertion would pass on a link to
// nothing, so the existence check is the other half.
//
// The ceiling test is a budget, not a target: what regrows is length, and no
// parser catches that. Its failure message states the disclosure rule, so a
// session that hits it knows where the material goes instead.
//
// The style guide's own pointer stays in `readme-styleguide.test.ts`: that
// file's subject is the guide, and this one's subject is the steering file.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const AGENTS_FILE = path.join(REPO_ROOT, 'AGENTS.md')
const ARCHITECTURE_FILE = path.join(REPO_ROOT, 'docs', 'agents', 'architecture.md')

// The retrospective measured 33.5 KB before the tree moved and projected about
// 15 KB after it; 24 KB is the budget that leaves roughly 9 KB of headroom.
// A kilobyte is 1000 bytes here, as in the measurement the budget came from.
const STEERING_CEILING_BYTES = 24_000

describe('the steering document', () => {
  it('points at the annotated architecture, and the document exists', () => {
    // The tree is the authority the standards review cites for module ownership,
    // so it must stay reachable from the map even though it is no longer in it.
    const agents = fs.readFileSync(AGENTS_FILE, 'utf8')
    expect(agents, 'AGENTS.md does not point at docs/agents/architecture.md').toContain(
      'docs/agents/architecture.md',
    )
    expect(fs.existsSync(ARCHITECTURE_FILE), 'docs/agents/architecture.md does not exist').toBe(
      true,
    )
  })

  it('stays inside its size budget', () => {
    // The budget exists because the map silently becomes a manual again; only
    // its length regrows, and no parser catches that.
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
