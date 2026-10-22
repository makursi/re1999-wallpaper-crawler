# Design Notes

A design or grill session is where a question gets worked into a decision tree;
a note is where that tree survives the session. Without one, the same question is
opened again, the second session re-reads the same files, and it ends in the same
fact-dump. #107 measured it: the same question opened three times in twelve
minutes, and the third session only worked because the maintainer pasted the
answer back in.

A note has four parts, always: the question, the settled branches, the open
branches, and the rejected branches with their reasons. The fourth is the one
that keeps a dead end dead; `HISTORY.md`'s rejected list does the same job for
code.

## Open: look for prior art first

Before the first round of a design or grill session, check two places:

- **Open issues** (`gh issue list --state open`, or `--search "<keywords>"`): an
  issue body may already be this question's settlement, or the ticket it became.
- **`docs/notes/`**: one file per topic. Read the file whose topic is this
  question; its `## Open` section says whether the question is still live.

If one of them answers the question, start from it and say so in the session. Do
not re-derive a decision that is already written; update the note if the answer
changed.

## Close: write the tree

Before the session ends, write `docs/notes/<topic>.md`. The name is a kebab-case
noun phrase for the topic (`iteration-loop`, `thumbnail-cache`), not a date and
not an issue number: a question that comes back updates the same file instead of
forking a second one. One file per topic.

Fill the four parts in this order, with these headings:

- `## The question` — one paragraph: the tension that opened the session, its
  trigger and the issue number. Not the answer.
- `## Settled` — every branch that was decided, the decision and the reason.
  Link the issue or ADR it became when it has one; the note does not restate the
  ticket.
- `## Open` — every branch still unresolved: what is unknown, what would settle
  it, and the fallback if it cannot be proven now.
- `## Rejected` — every branch that was considered and not taken, with the
  reason it lost. "We talked until we agreed" is not a settled branch, and an
  alternative with no reason is a branch nobody can trust.

A note that is only a plan, a meeting minute or a fact-dump is not a note. Its
reader is the next agent opening the same question, and the test is that the
note alone lets that agent name the answer: what is settled, what is still open,
and what not to propose again.

## The directory

`docs/notes/README.md` states what belongs in the directory. It holds one file
per topic plus that README; there is no index to maintain, because `ls` is the
index. A note is agent-facing and written in English, like the issues it cites.
