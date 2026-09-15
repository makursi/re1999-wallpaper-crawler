#!/usr/bin/env node
// Refuse to commit on the default branch. All work lands on main only through a
// merged PR (AGENTS.md › Git Conventions). Wired into simple-git-hooks'
// pre-commit, ahead of lint-staged, so the rule is enforced and not just asked.
//
// Emergency bypass (say why in the PR):  git commit --no-verify

import { execFileSync } from 'node:child_process'
import process from 'node:process'

const DEFAULT_BRANCHES = new Set(['main', 'master'])

function currentBranch() {
  try {
    return execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // Detached HEAD: `git symbolic-ref` exits non-zero.
    return ''
  }
}

function refuse(lines) {
  for (const line of lines) console.error(line)
  process.exit(1)
}

const branch = currentBranch()

if (branch === '') {
  refuse([
    'pre-commit: refusing to commit with a detached HEAD.',
    '            Branch first: git switch -c <type>/<slug>',
  ])
}

if (DEFAULT_BRANCHES.has(branch)) {
  refuse([
    `pre-commit: refusing to commit on '${branch}'.`,
    `            Work lands on ${branch} only through a merged PR.`,
    '            Branch first: git switch -c <type>/<slug>',
  ])
}

process.exit(0)
