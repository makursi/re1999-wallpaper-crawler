// ── The manifest a shipped root carries (#117) ──────────────────────
//
// The built tree IS the install root of the flat, npm-delivered release
// (spec #116): copied out of the repository, `npm install` puts `sharp` in
// `node_modules`, and `npm start` runs `node server.js` with the package root as
// the working directory — the one property that makes the zero-argument root
// resolution (`core/app-root.ts`) land on the tree itself. This module owns the
// shape of the manifest the build writes as `build/package.json`;
// `scripts/build.ts` reads the repository's fields and writes the result.
//
// It repeats three facts from the repository manifest on purpose, and each has
// exactly one source:
//
//   - `version` comes from `scripts/package-version.ts`, the same reader the
//     packager names the archive with (#79);
//   - `engines.node` is the repository's floor, which the build also injects
//     into the bundles (`RE1999_NODE_FLOOR`, enforced by `core/node-floor.ts`);
//   - `dependencies.sharp` is the build's one allowed external
//     (`scripts/bundle-externals.ts`). Everything else is inside the bundles, so
//     a second dependency here would make the user's `npm install` download
//     something the program never loads.
//
// `private: true` keeps the tree from ever being published by accident, and
// `type: "module"` is what lets Node read the bundles as ESM at all.

/** The one start script: the arguments enter through `npm start -- …`. */
export const START_SCRIPT = 'node server.js'

/** The shipped root's `package.json`, in the order the build writes it. */
export interface ShippedManifest {
  name: string
  version: string
  private: true
  type: 'module'
  engines: { node: string }
  scripts: { start: string }
  dependencies: { sharp: string }
}

/** A required non-blank string field, trimmed, or a failure naming the field. */
function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`shipped manifest: the repository package.json has no usable ${field}`)
  }
  return value.trim()
}

/** Whether an unknown value is a JSON object, the shape both manifests are read as. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Build the manifest the shipped root carries.
 *
 * `repository` is the parsed repository `package.json` — its `name` and the two
 * single-sourced fields; `version` is what `scripts/package-version.ts` read.
 * A manifest that cannot source one of them throws rather than writing a
 * `package.json` npm would install from and the program could not run.
 */
export function shippedManifestOf(repository: unknown, version: string): ShippedManifest {
  if (!isRecord(repository)) {
    throw new Error('shipped manifest: the repository package.json is not a JSON object')
  }

  const name = requiredString(repository.name, 'name')
  const nodeFloor = requiredString(
    isRecord(repository.engines) ? repository.engines.node : undefined,
    'engines.node',
  )
  const sharpSpec = requiredString(
    isRecord(repository.dependencies) ? repository.dependencies.sharp : undefined,
    'dependencies.sharp',
  )
  const releaseVersion = requiredString(version, 'version')

  return {
    name,
    version: releaseVersion,
    private: true,
    type: 'module',
    engines: { node: nodeFloor },
    scripts: { start: START_SCRIPT },
    dependencies: { sharp: sharpSpec },
  }
}
