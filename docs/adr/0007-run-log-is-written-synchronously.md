# Write the Run log synchronously, on the main thread

A Run's JSONL log is its audit trail: `run_report` is the only record of its
Gallery numbers, defects and download metrics, so a Run whose log stops early
cannot be assessed at all — and it looks exactly like a Run nobody audited. On
2026-09-15 the Run `2026-09-15T09-36-50` finished its work and **exited 0** while
its log kept **48 records and no `run_report`**, the last line written at
17:40:57.770; `images/.gallery-state.json` was updated at 17:41:03.118Z, which
proves the process reached the end of the Run. Both sinks went quiet at once
because `src/logger.ts` had put the file target and the `pino-pretty` console
target in one pino `transport` — a worker thread that can stop while the main
thread keeps logging into a dead channel and the process still exits 0. Why that
worker stopped was never established.

The Run log is therefore written with `pino.destination({ dest, sync: true })`
composed through `pino.multistream`, not through a transport: every record is on
disk before the logging call returns, so no in-process failure can cut the audit
trail short, and a synchronous write error surfaces as a throw at the call site
rather than going quiet.

## Considered options

- **Keep the transport and call `logger.flush()` on the completion and error
  paths.** This narrows the window without closing it: a worker that has already
  stopped has nothing left to flush, and the flush would live in the very path
  that just failed. Rejected as the fix.
- **Keep the file target in the worker but move only `pino-pretty` out.** The
  console is not the audit trail, so losing it is cosmetic. Rejected anyway: it
  leaves the process's only worker thread in place, and a silent console is the
  same symptom an operator cannot tell apart from a silent log.
- **Add `fsync: true`** (one `fsync` per record, so records survive a power cut
  and not just a process death). Rejected for now — the observed class is a
  stopped process, which `sync: true` already covers, and every record of a Run
  (269 in the Run that verified this change) would pay a real fsync. Revisit if
  "survives a power cut" ever becomes a requirement.
- **Rely on the stream order in the source.** pino's `multistream` writes with
  no error isolation, so a console stream that throws would cost the record —
  but reordering the array cannot fix that: `multistream.add()` sorts the
  streams by level (`compareByLevel`), so write order follows the levels and the
  array order is decoration. The file sink therefore keeps the lower level
  (`debug` against the console's `info`); raising it above the console's is what
  would put a throwing console stream ahead of the audit trail.

## Consequences

- One blocking `writeSync` per record on the main thread (269 records in the
  Run that verified this change). Accepted: this is a CLI that spends minutes in
  `execSync` regardless.
- The file sink carries the lower level (`debug`) of the two sinks, which is what
  keeps it ahead of the console in `multistream`'s level-ordered write loop — not
  the order the streams are listed in.
- The process no longer starts a thread-stream worker at all — the Run log was
  its only user — so the failure class is not mitigated but **removed**.
- The record contract is unchanged: the file stays one JSON object per line with
  the pino envelope, and the console keeps its `info`/`debug` split.
  `tests/logger.test.ts` pins both the synchronous write and the raw-JSONL
  shape.
- The missing-`run_report` trap stays in the runbook: a Run can still be killed
  or die before its last step. What changes is the cause that trap names.

Related: ADR 0002 (why the report lives inside the JSONL at all).
