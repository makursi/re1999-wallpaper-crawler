// ── The Node version this program needs (#117) ──────────────────────
//
// `package.json`'s `engines.node` is the floor's one source. `scripts/build.ts`
// injects it into the bundles exactly as it injects the version (#79): the
// `RE1999_NODE_FLOOR` define below carries the floor into the shipped tree, and
// a source run — which never defines it — has no check to make. The Console
// calls `currentNodeFloorRefusal` first in `main()` (`web/server/console.ts`):
// before the instance handshake, before a port is bound, and before anything
// can fail for a reason the reader would have to infer from broken thumbnails.
// A floor violation is one Chinese sentence on stderr and exit 1.
//
// **Only `>=X.Y.Z` is supported**, because that is the only syntax the
// repository's `engines.node` uses, and a floor parser that guesses is worse
// than one that is stated once. Anything else — an absent injection in a source
// run, a blank string, `22.22.1`, `^22`, `>=22` — is "no floor to enforce"
// here; `tests/core/node-floor.test.ts` pins the repository's own floor to the
// supported form so this module and `package.json` cannot drift apart. Only the
// numeric triple is compared: a prerelease suffix on the running version
// (`v22.22.1-rc.1`) is ignored, which is the direction npm's own engine check
// errs in.

import process from 'node:process'

/**
 * The identifier a bundled build replaces with the floor's string literal.
 *
 * `scripts/build.ts` maps `RE1999_NODE_FLOOR` to the repository manifest's
 * `engines.node`, beside `RE1999_VERSION`. A source run never defines it, and
 * `typeof` on an undeclared identifier is `'undefined'` rather than a
 * `ReferenceError`, which is the source run's "no check".
 */
declare const RE1999_NODE_FLOOR: string | undefined

/** The build-time floor, or `undefined` in a source run; blank is absent. */
export const BUILD_NODE_FLOOR: string | undefined =
  typeof RE1999_NODE_FLOOR === 'string' && RE1999_NODE_FLOOR.trim() !== ''
    ? RE1999_NODE_FLOOR.trim()
    : undefined

/** The one floor syntax this module supports, and the only one the repo uses. */
const SUPPORTED_FLOOR = /^>=\s*(\d+)\.(\d+)\.(\d+)$/

/** Node reports its version as `vX.Y.Z`, optionally with a prerelease suffix. */
const RUNNING_VERSION = /^v?(\d+)\.(\d+)\.(\d+)/

type Version = readonly [number, number, number]

/** The floor as three numbers, or `null` when it is not in the supported syntax. */
function floorVersionOf(floor: string | undefined): Version | null {
  const match = SUPPORTED_FLOOR.exec(floor?.trim() ?? '')
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** The running version as three numbers, or `null` when it is not one. */
function runningVersionOf(running: string): Version | null {
  const match = RUNNING_VERSION.exec(running.trim())
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** Whether the numeric triple is below the floor, comparing each part in order. */
function isBelow(running: Version, floor: Version): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (running[index] !== floor[index]) return running[index] < floor[index]
  }
  return false
}

/**
 * The refusal when `running` is below `floor`, or `null` when the floor is met —
 * and also `null` when there is no floor in the supported syntax to enforce.
 *
 * Pure: the caller supplies both versions, so the decision is testable without
 * a second Node installation.
 */
export function nodeFloorRefusal(running: string, floor: string | undefined): string | null {
  const required = floorVersionOf(floor)
  if (required === null) return null
  const current = runningVersionOf(running)
  if (current === null || !isBelow(current, required)) return null
  return `Node 版本不符合要求:当前是 ${running},程序需要 ${String(floor).trim()}。请安装新版本的 Node 后重新启动。`
}

/** `nodeFloorRefusal` for this boot: the build's injection and this process's Node. */
export function currentNodeFloorRefusal(running: string = process.versions.node): string | null {
  return nodeFloorRefusal(running, BUILD_NODE_FLOOR)
}
