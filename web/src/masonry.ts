// ── The wall's columns ──────────────────────────────────────────────
//
// A masonry wall is one decision repeated: for each tile, in order, which
// column does it stand in? The answer this page uses is the gallery's own — the
// tile goes to the column that is shortest at the time it is placed — and the
// measurement is the tile's own height for the column's width, which is the
// aspect ratio the Mirror reported (web/server/image-sizes.ts). Nothing here
// touches the DOM, the service or the images: it takes a list, a count and a
// height, and gives back the columns.
//
// It is a separate module because it is the one part of the rework that is a
// decision rather than a style, and because a wrong one is invisible in a
// screenshot: a tile in the wrong column just looks like a wall. The page hands
// it the rows in gallery order and renders what comes back, so the wall is
// deterministic — the same Mirror always lays out the same way.

/**
 * The tiles, dealt into `columnCount` columns, each tile into the shortest
 * column at the time it is reached. A tie goes to the leftmost column, which is
 * what makes the layout stable rather than dependent on iteration order.
 *
 * Exactly `columnCount` arrays come back — empty ones included — so the caller
 * can render the same number of columns whatever the wall's size, instead of
 * the troughs appearing and disappearing as the Mirror grows.
 */
export function columnsOf<T>(
  items: readonly T[],
  columnCount: number,
  heightOf: (item: T) => number,
): T[][] {
  if (columnCount < 1) throw new Error(`columnCount must be at least 1, got ${columnCount}`)
  const columns: T[][] = Array.from({ length: columnCount }, () => [])
  const heights: number[] = Array.from({ length: columnCount }, () => 0)

  for (const item of items) {
    // The leftmost minimum: `reduce` keeps the earlier index on a tie because
    // the comparison is strict.
    let shortest = 0
    for (let index = 1; index < columnCount; index++) {
      if (heights[index] < heights[shortest]) shortest = index
    }
    columns[shortest].push(item)
    // A height that is not a positive number would silently wreck the balance
    // (NaN poisons every later comparison), so it is treated as one column unit.
    const height = heightOf(item)
    heights[shortest] += Number.isFinite(height) && height > 0 ? height : 1
  }

  return columns
}
