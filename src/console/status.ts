// ── The status payload's assembly ───────────────────────────────────
//
// One pure function, fed by facts that arrive by injection. #32 injects the
// fixed idle state and an unread Gallery list; #33/#34/#36 replace those two
// readers without touching the server (spec decision 16).

import type { GalleryList } from '../gallery/gallery-source.js'
import type { RunDefects } from '../report/run-log.js'
import type {
  ConsoleDefects,
  ConsoleRunState,
  ConsoleStatusPayload,
  ConsoleVerdict,
} from './api-types.js'

/** `true` only while `A` and `B` are the same type, in both directions. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/**
 * The API's defect block, checked against the Run report's on the way through.
 *
 * `api-types.ts` declares it structurally instead of importing it, because the
 * page's tsconfig has no node types and `run-log.ts` reaches `node:fs` through
 * `gallery-state.ts`. The conditional parameter is what keeps the two from
 * drifting: a field added, dropped or retyped on either side turns the argument
 * type into `never`, so this stops compiling rather than letting the page
 * silently lose a defect class.
 */
function toApiDefects(
  defects: Same<RunDefects, ConsoleDefects> extends true ? RunDefects | null : never,
): ConsoleDefects | null {
  return defects
}

/** The Run half of the status, as a reader hands it over. */
export interface ConsoleRunFacts {
  runId: string | null
  state: ConsoleRunState
  startedAt: string | null
  verdict: ConsoleVerdict | null
  defects: RunDefects | null
}

/** The Gallery half: what the list contributed, or that it was not read. */
export interface ConsoleGalleryFacts {
  officialTotal: number | null
  listAvailable: boolean
}

/** Everything the payload is built from. */
export interface ConsoleStatusFacts {
  run: ConsoleRunFacts
  /** The Mirror's non-dot entry count (src/console/mirror.ts). */
  mirrorCount: number
  gallery: ConsoleGalleryFacts
}

/** No Run is in flight and no Run log has been read — that half is #34's. */
export const IDLE_RUN_FACTS: ConsoleRunFacts = {
  runId: null,
  state: 'idle',
  startedAt: null,
  verdict: null,
  defects: null,
}

/** Before #33 reads the list: "not read", never "nothing missing". */
export const UNREAD_GALLERY_FACTS: ConsoleGalleryFacts = {
  officialTotal: null,
  listAvailable: false,
}

/**
 * The Gallery half from what `GalleryListSource.get()` returned — the same
 * source the gallery route reads, so `/api/status` and `/api/gallery` cannot
 * disagree about whether the list was read (#33).
 *
 * `officialTotal` is the list's own `total`, verbatim — never
 * `entries.length`, and never a count of files (§4.5).
 */
export function galleryFactsOf(list: GalleryList | null): ConsoleGalleryFacts {
  return list === null ? UNREAD_GALLERY_FACTS : { officialTotal: list.total, listAvailable: true }
}

/**
 * The status payload, in the one shape `src/console/api-types.ts` declares.
 * The fields are listed rather than spread so that a change to the contract
 * has to be made here as well.
 */
export function buildStatus({
  run,
  mirrorCount,
  gallery,
}: ConsoleStatusFacts): ConsoleStatusPayload {
  return {
    runId: run.runId,
    state: run.state,
    startedAt: run.startedAt,
    mirrorCount,
    officialTotal: gallery.officialTotal,
    verdict: run.verdict,
    defects: toApiDefects(run.defects),
    listAvailable: gallery.listAvailable,
  }
}
