// ── What a bundle may still import at run time ───────────────────────
//
// The build has one promise: the shipped file contains the program, so a tree
// with no `node_modules` still runs. What makes that a fact rather than an
// intention is esbuild's metafile — it reports every import the bundle left
// unresolved — and the two readings here are what `scripts/build.ts` applies to
// it:
//
//   - `undeclaredExternals` names anything external that the build did not
//     knowingly exclude, so a package that cannot be bundled is a build failure
//     with its name on it instead of a `Cannot find module` on the owner's
//     machine (#84);
//   - `bundledPackages` names what actually went in, which is the build's
//     report — "everything else bundles" is checkable, not a hope.
//
// Node's own modules are the runtime's, not the tree's: `node:fs` is as allowed
// as `process` is. The allow-list holds exactly one entry, and it is native.

import { isBuiltin } from 'node:module'

/** The imports one built file still has, in esbuild's metafile terms. */
export interface BundleOutputImports {
  /** The built file this belongs to, as the build names it. */
  file: string
  /** The bare module specifiers the bundle left external, deduplicated or not. */
  imports: readonly string[]
}

/**
 * The only package a bundle may leave out: `sharp` links a platform binary that
 * cannot be bundled, and it is already an `await import` at the request site
 * (`web/server/thumbnails.ts`), so the tree carries it as a module.
 */
export const ALLOWED_EXTERNALS: readonly string[] = ['sharp']

/** An external import the build did not declare. */
export interface UndeclaredExternal {
  file: string
  specifier: string
}

/**
 * The externals this build may not have: everything that is not the allow-list
 * and not a Node builtin.
 *
 * Reported per file so the message can name the bundle that would have needed
 * `node_modules` — the difference between "the build is wrong" and "which build
 * is wrong". Duplicates collapse: one import site or twenty is one declaration.
 *
 * Node builtins are recognised by the platform's own definition, because the
 * metafile names them both ways: this repository's sources write `node:fs`,
 * while a bundled CommonJS dependency's `require('fs')` arrives as a bare `fs`.
 */
export function undeclaredExternals(
  outputs: readonly BundleOutputImports[],
  allowed: readonly string[] = ALLOWED_EXTERNALS,
): UndeclaredExternal[] {
  const seen = new Set<string>()
  const found: UndeclaredExternal[] = []

  for (const output of outputs) {
    for (const specifier of output.imports) {
      if (isBuiltin(specifier)) continue
      if (allowed.includes(specifier)) continue
      const key = `${output.file}\u0000${specifier}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ file: output.file, specifier })
    }
  }

  return found
}

/**
 * The packages esbuild actually read into the bundles, sorted.
 *
 * esbuild's metafile names the files it resolved, and under pnpm those live one
 * `node_modules` inside another (`node_modules/.pnpm/hono@…/node_modules/hono/…`),
 * so the package name is what follows the **last** `node_modules/`. A file of
 * the program's own has no such segment and is not a package.
 */
export function bundledPackages(inputs: readonly string[]): string[] {
  const names = new Set<string>()

  for (const input of inputs) {
    const normalized = input.replaceAll('\\', '/')
    const marker = 'node_modules/'
    const at = normalized.lastIndexOf(marker)
    if (at === -1) continue

    const [head, ...rest] = normalized.slice(at + marker.length).split('/')
    if (head === undefined || rest.length === 0) continue
    // A scoped name is two segments; the rest is the file inside it.
    const name = head.startsWith('@') ? `${head}/${rest[0]}` : head
    names.add(name)
  }

  return [...names].toSorted()
}
