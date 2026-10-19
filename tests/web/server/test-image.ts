// Fixture images for the Console's tests, at a size the test chooses.
//
// The image library is imported dynamically, in a helper, so a test can build
// real bytes without a copy of the library's call in it; production keeps its
// one import site (`web/server/thumbnails.ts`).

/** Write a solid-colour PNG of exactly `width`×`height` and return its path. */
export async function writeTestImage(file: string, width: number, height: number): Promise<string> {
  const { default: sharp } = await import('sharp')
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 60, b: 90 },
    },
  })
    .png()
    .toFile(file)
  return file
}
