// ── Start the built Console against the repository's own data ─────
//
// `build/` is a complete application root — that is what the package ships — so
// running it as-is makes the Console read `build/.env` and write `build/data/`,
// which is not where a developer's Mirror and Run logs are. The two roots are
// inputs (#78), so the developer's path supplies them: the program is the build
// tree, the data is the repository's, exactly as `<install>\app` and
// `<install>\data` sit beside each other in the package.
//
// A shell script cannot set both roots portably, which is why this is a program.
//
// It also migrates the checkout **before** the Console boots, and against the
// repository's root rather than `build/`. That is not belt-and-braces: a
// pre-#80 checkout keeps `images/` and `logs/` beside the sources, the migration
// finds them under the application root, and a boot whose root is `build/` would
// find nothing, write the layout marker, and thereby disable the migration for
// every later start. The marker must be written by a start that could have seen
// the old data.

import * as path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { ensureDataLayout } from '../core/data-layout.js'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const appRoot = path.join(repositoryRoot, 'build')
const dataRoot = path.join(repositoryRoot, 'data')

// The old layout's directories are the schema's defaults; a checkout that
// customised them will be migrated by a Run, which reads the configuration.
const prepared = ensureDataLayout({ appRoot: repositoryRoot, dataRoot })
if (!prepared.ok) {
  process.stderr.write(`${prepared.refusal.message}\n`)
  process.exit(1)
}
for (const move of prepared.ready.migrated) {
  process.stdout.write(`已把 ${move.source} 迁移到 ${move.target}\n`)
}

process.env.RE1999_APP_ROOT ??= appRoot
process.env.RE1999_DATA_ROOT ??= dataRoot

await import(pathToFileURL(path.join(appRoot, 'server.js')).href)
