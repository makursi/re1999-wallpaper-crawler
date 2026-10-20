// ── The wall's columns, as data ─────────────────────────────────────
//
// The rework's one genuinely pure decision (#48): a masonry wall is a
// distribution, and the distribution is what makes the wall balanced. The
// expected columns below are worked out by hand from the rule the module
// documents — a tile takes the shortest column, a tie takes the leftmost — and
// not by re-running the algorithm, so the test can disagree with it.

import { describe, expect, it } from 'vitest'

import { columnsOf } from '../../../../web/src/lib/masonry.js'

/** The tiles are their own heights here: the function under test takes a list. */
const byHeight = (height: number): number => height

describe('columnsOf', () => {
  it('gives back exactly the columns it was asked for, even with nothing to place', () => {
    expect(columnsOf([], 5, byHeight)).toEqual([[], [], [], [], []])
  })

  it('places one tile in each column before it stacks any of them', () => {
    // Five equal tiles, five columns: the tie always goes left, so the columns
    // are filled in order and none of them is a stack.
    expect(columnsOf([2, 2, 2, 2, 2], 5, byHeight)).toEqual([[2], [2], [2], [2], [2]])
  })

  it('sends the sixth tile to the leftmost of the equally short columns', () => {
    // All five columns are 2 high, so the leftmost is the shortest.
    expect(columnsOf([2, 2, 2, 2, 2, 2], 5, byHeight)).toEqual([[2, 2], [2], [2], [2], [2]])
  })

  it('gives a tall tile its own column and puts the short ones beside it', () => {
    // Heights 16, 9, 9, 9, 9 into two columns, by hand:
    // 16 → c0 (16)   9 → c1 (9)   9 → c1 (18)   9 → c0 (25)   9 → c1 (27)
    expect(columnsOf([16, 9, 9, 9, 9], 2, byHeight)).toEqual([
      [16, 9],
      [9, 9, 9],
    ])
  })

  it('reads the height off the tile it is given, not off a parallel list', () => {
    const tiles = [
      { h: 3, id: 'a' },
      { h: 1, id: 'b' },
      { h: 1, id: 'c' },
    ]

    // 3 → c0 (3), then 1 → c1 (1) and 1 → c1 (2): c1 stays the shorter column
    // even after its first tile, which is the whole point of measuring.
    expect(columnsOf(tiles, 2, tile => tile.h)).toEqual([
      [{ h: 3, id: 'a' }],
      [
        { h: 1, id: 'b' },
        { h: 1, id: 'c' },
      ],
    ])
  })

  it('refuses a wall with no columns rather than returning nothing', () => {
    expect(() => columnsOf([1], 0, byHeight)).toThrow('columnCount must be at least 1')
  })

  it('treats an unusable height as one unit instead of poisoning the balance', () => {
    // `NaN` would make every later comparison false and pin the wall to the
    // first column; the tile is counted as a column unit instead.
    expect(columnsOf([Number.NaN, 1, 1], 3, byHeight)).toEqual([[Number.NaN], [1], [1]])
  })
})
