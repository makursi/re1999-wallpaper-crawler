// ── Which band the wall shows (#83) ─────────────────────────────────
//
// The first-run wall has to explain itself, and a wall that already holds a
// few hundred Wallpapers has to say the next start continues rather than
// restarts. Which of those the page says is a rule, not a template detail, so
// it is a pure function here: the page supplies the two numbers the status
// contract already carries — the Mirror's count and the Gallery list's total —
// and the wall only renders the answer.
//
// `null` is the contract's "the list was not read", never "zero left"; that is
// why the remaining count is nullable and the band refuses to claim a resume it
// cannot measure.

/** What the wall is told: the two live counts, and whether a Run is in flight. */
export interface WallFacts {
  /** Wallpapers in the Mirror, as the freshest read reports them. */
  mirrorCount: number
  /** What the Gallery list says the gallery holds; `null` = not read. */
  officialTotal: number | null
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
 * is either complete, or unmeasurable and not empty — the caption already
 * carries the counts in both cases.
 */
export type WallBand = 'running' | 'orphaned' | 'empty' | 'resume' | 'none'

/**
 * The band the wall shows, by precedence:
 *
 *   1. a Run in flight — progress, even before the first file lands;
 *   2. an interrupted Run — what reopening found, and where the cleanup is;
 *   3. an empty Mirror — the one action that matters;
 *   4. a list that still names Wallpapers the Mirror does not hold — resume;
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
  if (facts.mirrorCount === 0) return 'empty'
  if (facts.officialTotal !== null && facts.officialTotal > facts.mirrorCount) return 'resume'
  return 'none'
}

/**
 * How many Wallpapers the Gallery list names that the Mirror does not hold, or
 * `null` when the list was not read.
 *
 * Clamped at zero: a Mirror with files the gallery has since dropped holds more
 * files than the list names, which is not a negative number of downloads.
 */
export function remainingOf(facts: WallFacts): number | null {
  if (facts.officialTotal === null) return null
  return Math.max(0, facts.officialTotal - facts.mirrorCount)
}
