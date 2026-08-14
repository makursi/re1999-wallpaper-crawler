# Run report as a structured record inside the JSONL, not a separate report file

Each run's observable results — stability signals and detected defects — are
written as a single structured `type: run_report` log record inside the same
JSONL file as everything else, so an agent can assess a run by reading one
file and one record. We considered separate `report.json` / `report.md`
artifacts and rejected them: two representations of the same data drift
apart, and the agent would need to know which file to open. Keeping the
report in the JSONL makes the log self-contained and the report trivially
grep-able (`"type":"run_report"`).

## Considered options

- **Separate `report.json`**: machine-readable but splits the run's story
  across two files and can silently disagree with the JSONL.
- **Separate `report.md`**: human-friendly but adds a second serialization
  that must be kept in sync; the agent consumes JSON anyway.
- **Report as a JSONL record (chosen)**: single source of truth, single
  file per run, `run_report` greppable, and the JSONL stays the canonical
  audit trail.

## Consequences

- The report shares the pino envelope (`level`, `time`, `pid`, `hostname`),
  so consumers must look at the `type` field to find it.
- `run_meta` (config snapshot) and `run_report` are both records in the same
  file; cross-run aggregation (not yet automated) will read these records
  across files.
