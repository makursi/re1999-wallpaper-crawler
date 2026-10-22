// ── Which band the wall shows (#83) ─────────────────────────────────
//
// The first-run wall has to explain itself, and a wall that already holds a
// few hundred Wallpapers has to say the next start continues rather than
// restarts. Which of those the page says is a rule, not a template detail, so
// it is a pure function here: the page supplies the wall's own row count, the
// figures' downloaded/missing counts (#94), and the live Mirror count a Run
// writes, and the wall only renders the answer.
//
// The resume decision is the Mirror gap's `missing`, verbatim — never "the total
// is bigger than the Mirror count". A local file the site retired counts towards
// the Mirror but not towards the list, so the subtraction can read as complete
// while a dozen Wallpapers are still absent.
//
// `null` is the contract's "the list was not read", never "zero left"; that is
// why the missing count is nullable and the band refuses to claim a resume it
// cannot measure.

/** What the wall is told: what it draws, what the gap says, and what is live. */
export interface WallFacts {
  /** Wallpapers the wall draws now: the rows of the page's one gallery read. */
  wallpaperCount: number
  /** Official entries whose file is on disk; `null` = the list was not read. */
  downloaded: number | null
  /** What the Gallery list says the gallery holds; `null` = not read. */
  officialTotal: number | null
  /**
   * The Mirror gap's missing count — the list's names the disk does not hold;
   * `null` = the list was not read.
   */
  missing: number | null
  /**
   * Wallpapers in the Mirror as `/api/status` counts them right now. Only the
   * running band's progress reads it: a Run writes files the wall has not
   * re-read, and progress is not the header.
   */
  liveMirrorCount: number
  /** Whether a Run is in flight now. */
  running: boolean
  /**
   * Whether the newest Run log is an interrupted Run the Console treats as an
   * Orphaned Run. A start is refused until it is cleaned up, so the wall must
   * name that state instead of offering a control that cannot work.
   */
  orphaned: boolean
}

/**
 * What the wall says above its tiles. `none` is a wall that needs no band: it
 * is either complete, or unmeasurable and not empty — the header already
 * carries the counts in both cases.
 */
export type WallBand = 'running' | 'orphaned' | 'empty' | 'resume' | 'none'

/**
 * The band the wall shows, by precedence:
 *
 *   1. a Run in flight — progress, even before the first file lands;
 *   2. an interrupted Run — what reopening found, and where the cleanup is;
 *   3. an empty wall — the one action that matters;
 *   4. a Mirror gap that still names Wallpapers the disk does not hold — resume;
 *   5. otherwise nothing.
 *
 * A Run in flight outranks "empty" because the reader who just clicked start
 * must see the fetch moving, not the invitation repeat itself. An interrupted
 * Run outranks "empty" for the opposite reason: the start would be refused, so
 * the empty invitation would be a dead end.
 */
export function wallBandOf(facts: WallFacts): WallBand {
  if (facts.running) return 'running'
  if (facts.orphaned) return 'orphaned'
  if (facts.wallpaperCount === 0) return 'empty'
  if (facts.missing !== null && facts.missing > 0) return 'resume'
  return 'none'
}

/**
 * How many Wallpapers the Gallery list names that the Mirror does not hold, or
 * `null` when the list was not read.
 *
 * The gap's own number, passed through: the resume control and the header's
 * "missing" are the same fact, and the reader is never asked to subtract two
 * counts that a retired local file can make look complete.
 */
export function remainingOf(facts: WallFacts): number | null {
  return facts.missing
}
