// ── `更新.bat`'s program half (#87) ─────────────────────────────────
//
// The launcher is ASCII and logic-free (see `packaging/启动.bat`): cmd.exe
// renders a `.bat`'s Chinese through the console's code page, so every word the
// person at the window reads is written here, from Node, which writes Unicode.
//
// The launcher hands this entry two things and nothing else:
//
//   argv[2]  the package root — `%~dp0.`, the folder the new zip was extracted
//            to, and therefore where the new `app\` is. The `.` matters: a
//            quoted argument ending in `\` escapes its own closing quote on
//            Windows.
//   argv[3]  the path the user dragged onto `更新.bat`, when they dragged one.
//            This is how a renamed or moved installation is found when
//            `%LOCALAPPDATA%`'s pointer is stale.
//
// The updater's own logic is `web/server/updater.ts`; this file only speaks to
// the window: print the answer, keep a success visible long enough to read, and
// leave a non-zero exit code for the launcher's `pause` on failure.

import process from 'node:process'
import { createInterface } from 'node:readline/promises'

import { updateInstallation } from './updater.js'

const USAGE = 'update.js <package-root> [target]'

/** Keep the success message on screen until the user has read it. */
async function waitForEnter(): Promise<void> {
  // A piped stdin (a test, a script) must not wait for a keypress.
  if (!process.stdin.isTTY) return
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await rl.question('\n按回车键关闭这个窗口。')
  } finally {
    rl.close()
  }
}

function successLines(outcome: {
  installRoot: string
  previousVersion: string | null
  installedVersion: string | null
}): string[] {
  const version =
    outcome.previousVersion !== null && outcome.installedVersion !== null
      ? `版本 ${outcome.previousVersion} → ${outcome.installedVersion}`
      : null
  return [
    `已更新:${outcome.installRoot}`,
    ...(version === null ? [] : [version]),
    '旧的程序留在 app.old\\,新版本打不开时可以关掉程序,把 app.old\\ 改名回 app\\ 再启动。',
    'data\\ 目录没有被改动。现在可以双击 启动.bat 打开新版本。',
  ]
}

async function main(argv: string[]): Promise<number> {
  const [packageRoot, target] = argv
  if (packageRoot === undefined || packageRoot.trim() === '') {
    process.stderr.write(`用法: ${USAGE}\n`)
    return 2
  }

  let outcome: Awaited<ReturnType<typeof updateInstallation>>
  try {
    outcome = await updateInstallation({
      packageRoot,
      targetArgument: target ?? null,
    })
  } catch (error) {
    // `updateInstallation` answers every expected failure; this is the
    // unexpected one, and a window that closes on a stack trace is worse.
    process.stderr.write(
      `更新时发生意外错误:\n${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }

  if (outcome.kind === 'refused') {
    process.stderr.write(`${outcome.message}\n`)
    return 1
  }

  process.stdout.write(`${successLines(outcome).join('\n')}\n`)
  await waitForEnter()
  return 0
}

process.exitCode = await main(process.argv.slice(2))
