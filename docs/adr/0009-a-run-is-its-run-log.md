# A Run's truth is its Run log, not the handle that started it

The Console has to answer "what Runs exist, and what is the newest one doing?"
for Runs it did not start. A service that tracks only the child processes it
spawned cannot see a Run started from a terminal, forgets every Run when it
restarts, and has no answer at all for a log that stopped before its
`run_report` — the failure ADR 0007 records, where Run `2026-09-15T09-36-50`
finished its work, exited 0 and kept 48 records with no `run_report`, while
`images/.gallery-state.json` proved the process reached the end of the Run. A
process handle says nothing about any of that.

The Console's knowledge of Runs is therefore the Run log directory: which files
exist, which carry a `run_meta` and no `run_report`, and when they were last
written. Progress is drawn from contract facts only — the newest log's
`run_meta` for the Run's identity and config snapshot, the Mirror's file names
for the count, and the closing `run_report`. The per-file records in between are
not parsed: only `run_meta` and `run_report` are governed by the log's
validation schema, so the rest is an internal detail of the pipeline and not a
contract to build on. No new record type is added to serve the view.

Three rules follow from reading Runs as logs rather than as handles.

**One Run at a time.** The pipeline clears the Browser session and deletes its
data as its first step, then reuses one persistent named session throughout, so
two concurrent Runs would destroy each other's state. A second start request is
refused with that reason; it is never queued.

**Stopping the service kills the whole process tree.** On Windows a parent's
death does not take its children, and the tree here is the service, the
run-time loader, the browser CLI and a real browser window. Killing only the
first would leave a headed browser open and the Run log truncated before its
`run_report`. Closing the page, by contrast, never stops anything: the page is a
view, and the truth is on disk. Stopping the service while a Run is in flight
therefore requires explicit confirmation.

**An Orphaned Run is a first-class state, not an error path.** A log with a
`run_meta`, no `run_report` and a recent modification time is reported as
orphaned, and it can be cleaned from the page, after which a new Run can start.
This is the counterpart of the rule the runbook insists on: a missing Run report
is a defect in the log, not evidence that the Run failed.

## Considered options

- **Track Runs by the child process handle**: sees only the Runs the Console
  started itself — a Run from a terminal is invisible, a Console restart forgets
  everything, and a live handle says nothing about whether the log reached its
  `run_report`. Rejected.
- **Queue a second Run request instead of refusing it**: the first thing a Run
  does is clear and delete the browser session it shares with any other Run, so
  a queued Run would wait only to corrupt the state of the one in flight.
  Refusing with the reason stated is what makes a busy Console readable.
  Rejected.
- **Stop the service without killing the whole tree** (kill the service process
  and let the child outlive it): measured Windows behaviour — a parent's death
  does not take its children — leaves a headed Chrome window and a Run log
  truncated before its `run_report`. Rejected.
- **Treat a log that stops before `run_report` as a failed Run**: inverts the
  repository's most-misread fact (ADR 0007, and the runbook's Verify step, which
  separates "the Run finished, the log is lost" from "the Run never got there").
  The state is `orphaned`, and naming it is what lets cleanup follow. Rejected.
- **Add a progress record to the Run log, or parse the child's stdout**: the
  pipeline's only streamable surface is the log the main thread writes, and its
  record contract is frozen for this work; a second channel would be a second
  representation of a Run, which is what ADR 0002 rejects. Rejected.

## Consequences

- A Run started from a terminal appears in the Console exactly like one it
  started itself, and restarting the Console loses no view.
- An Orphaned Run is identified from the log directory alone. It also means a
  log whose Run is genuinely still writing is indistinguishable from a leftover
  for as long as its modification time is recent — the cleanup is offered, not
  forced.
- The progress number is the Mirror's file count, so no per-file log record is
  required for the page to show how far a Run has got.
- The whole-tree kill and the stop confirmation have no HTTP representation, so
  their pure decision seams are unit-tested — `stopDecision`, `killProcessTree`'s
  command shape and the cleanup/start refusals in
  `tests/console/run-control-lifetimes.test.ts`, and the state table in
  `tests/console/run-state-lifetimes.test.ts` — while the actual process-tree
  kill and the confirmation prompt still need a manual run, and are otherwise
  checked by reading the code rather than by the test suite.

Related: ADR 0002 (why the Run report lives inside the JSONL), ADR 0007 (why a
missing `run_report` is a log defect), ADR 0008 (why the Console stays out of
the pipeline's process).
