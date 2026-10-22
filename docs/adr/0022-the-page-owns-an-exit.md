# The page owns an exit, and only the exit

ADR 0016 and ADR 0020 decided that the page has no stop control. The reason was
sound at the time: the page is a view, a Run's truth is its log, and a button
that claimed to stop a Run would either lie about what it stopped or need a
process handle the page deliberately does not keep (ADR 0009).

On the first release, that decision met its player. People close the browser tab
and believe they stopped the program, because a page that looks like the
application should have a way out; the only real stop is a black console window
they may not connect to it. The alternative to a page control was not "nothing
gets stopped" — it was "the download keeps running while the reader believes it
stopped", which is exactly the lie the old decision was meant to avoid.

The page therefore owns one control, and it is an **exit**: it ends the whole
program. It never stops a Run alone, never pauses one, and never keeps the
service alive after the page is done. That is the smallest control that makes
the page honest, because it stops exactly what the reader thinks it stops.

- **One rule, two doors.** The confirmation rule is not new. `stopDecision(state)`
  in `web/server/run-control.ts` already decides whether a stop must ask first: a
  Run in flight does, an Orphaned Run does not (it is not a life, and the Console
  has no handle for it). The terminal signal and the page's exit both read that
  function; `exitDecisionOf` is a reuse with the caller's confirmation folded in,
  not a second predicate.
- **One HTTP path.** `POST /api/exit` with a JSON body `{"confirm": boolean}`,
  behind the same token / `Host` / `Origin` guard as every other route.
  `202 {"exiting": true}` when the service will stop; `409 {"exiting": false,
  "refusal": {"code": "exit-confirm-required", "missing": []}}` while a Run is in
  flight and the caller has not confirmed. The route only relays the decision;
  the status comes from the module that owns it.
- **The page owns the words.** `exit-confirm-required` joins the contract's
  refusal vocabulary (`web/api-types.ts`), and both locales carry its sentence
  plus the confirmation, the failure and the exited notice (ADR 0014). The
  service never writes a sentence.
- **The exit is composition-root glue.** `web/server/console.ts` kills the whole
  process tree this Console started (Windows: `taskkill /T`, ADR 0009), closes
  the service, lets the existing `process.once('exit')` handler remove the
  instance record (ADR 0020), prints the Chinese lines, and exits 0. The
  controller schedules that shutdown on a short timer, so the `202` is written
  first — the page must not be answered with a dropped connection.
- **Only the tree this Console started is killed.** A Run started in a terminal
  has no pid here. The service stops; the Run may keep writing; the terminal and
  the page both say that only the service stopped and never claim a kill they
  cannot perform.
- **The Chinese is Node's, and the window stays.** The launcher stays ASCII and
  logic-free; the title and the opening line name both stops (closing the window,
  the page's Exit). On exit it prints that the service stopped, that a killed
  Run's log is truncated and the next start must clear the interrupted record as
  an Orphaned Run, and that the program exited. `启动.bat` gains a `pause` on the
  success path too, so a double-clicked start keeps its last lines on screen; a
  key press closes it.
- **ADR 0009 stands.** The exit never deletes or rewrites a Run log; killing a
  Run leaves a truncated log, which is what the next start reports as orphaned
  and offers to clean from the Run panel. Closing the page still stops nothing:
  only this explicit control, a signal, or the window is a stop.

## The conditions that make the reversal honest

1. The page's control is an **exit**, not a stop or pause of a Run. There is no
   "stop the Run but keep the service", because such a control would need the
   handle ADR 0009 refuses and would leave a page polling a program with no work.
2. The confirmation predicate is **literally the terminal's** — one function,
   `stopDecision`. The page never decides when to ask; it surfaces the service's
   `409`.
3. The decision lives in `run-control.ts`, and the **lifecycle stays in the
   composition root**. Routes translate to HTTP; they do not decide.
4. The answer is **written before the shutdown is scheduled**, and the scheduled
   shutdown runs once even if Exit is clicked twice.
5. **Ownership is a handle, not an image name.** Only the child this Console
   spawned is killed; a terminal Run is reported as not ours.
6. **Every reader-visible Chinese line comes from Node**, and the launcher's
   window survives both success and failure so the last lines can be read.
7. The refusal code is in the **contract vocabulary**, with copy in both locales.
8. The page still **starts nothing on its own** and holds nothing open after the
   exit; the exited page halts the status poll and becomes a notice.

## Considered options

- **Keep "the page has no stop control" (ADR 0016/0020)**: rejected. The
  measured failure is the reader closing the tab while the download continues; a
  page that looks like the program but cannot end it teaches the wrong model.
- **Stop the Run but keep the service**: rejected. A Run's truth is its log and
  the Console owns no handle for a terminal Run (ADR 0009); the control would be
  a second, partial stop that leaves the page alive and polling. The exit is the
  whole stop, and that is why it can be honest.
- **Let the page decide when to ask from its own status**: rejected. That is a
  second rule, and the status the page last read may be stale. The service
  answers `409` and the dialog follows that answer.
- **Kill by image name, or kill only the service process**: rejected. On Windows
  a parent's death does not take its children, so the Run (and anything it
  spawned) survives; killing by image name could reach a process the owner
  started. The tree is the pid the launcher recorded, and nothing else.
- **Run the shutdown inline and rely on the response being flushed**: rejected.
  The socket may close under the page's `202`; the timer is the guarantee.
- **Put the Chinese in `启动.bat`**: rejected for the measured reasons in ADR
  0020 — a `.bat`'s Chinese depends on the console code page, a BOM breaks the
  first line, and `chcp 65001` changes cmd's own messages too.
- **Let the window close immediately on a successful exit**: rejected. Stories 2
  and 6 are the same story: the last Chinese line is what tells the reader what
  stopped; a window that vanishes takes the evidence with it.
- **Rewrite ADR 0016 or 0020 in place**: rejected. They record the decision of
  their day and are quoted elsewhere; this ADR supersedes exactly one clause.

## Consequences

- ADR 0016's "the page gains no stop control" and ADR 0020's "the page still has
  no stop control" are superseded by this ADR on that clause only. Everything
  else in both stands: one program, one service, one window; the instance
  record and the second-double-click handshake; the ASCII launcher with the
  Chinese in Node.
- The page gains one route, covered by the guard by construction, and one module
  of state (`web/src/composables/usePageExit.ts`): exiting, awaiting
  confirmation, exited, failure. After a `202` the exited notice replaces the
  page and the status poll is halted (`useConsoleStatus().halt()`), because a
  read can no longer succeed.
- `stopDecision` gains its second caller and stays the one rule; the exit
  controller, the pure decision and the status are unit-tested, and the bound
  service is socket-tested for `409`, the two `202`s, `405` with `allow`, `403`
  without the token, and a shutdown that runs exactly once.
- The composition root is still not unit-tested: it is verified by building the
  tree and booting it once outside the repository — click Exit, read the terminal,
  observe exit code 0 and the removed instance record, then start again.
- A terminal Run cannot be killed from the page, and both sides say so. That is
  the honest limit of a view that owns no handle.
- An interrupted Run is not a special exit state: it is the Orphaned Run the next
  start reports, with the cleanup the panel already offers (#36).

Related: ADR 0007 (the Run log is written synchronously), ADR 0009 (a Run's
truth is its Run log; the stop decision; the whole-tree kill), ADR 0014 (the
interface speaks two languages), ADR 0016 and ADR 0020 (the superseded clause),
ADR 0019 (data lives beside the program), #93, #96.
