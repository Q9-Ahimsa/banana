# banana log auto-writes the canon continuation entry

When `banana log append`/`close` finds that the target open entry's heading is no longer
the file's last heading (canon SESSION-LOG.md §3 concurrency guard), the tool writes the
canon-prescribed continuation entry itself — announced on stderr, new id on stdout,
`--no-continue` opts out (refusal, exit 2). Adjacency is decided on the grep unit
(`^## \[`), not on parsed entries, because a hand-mangled heading is invisible to the
parser but poisons the documented greps. Decided 2026-08-12 with the 3-lens interface
panel for ticket #7; canon v2.3 pins the continuation's exact shape.

## Consequences

- An append/close may land a different id than the caller predicted — the id on stdout is
  authoritative, and harness scripts must read it.
- Every continuation retires its predecessor via `SUPERSEDES:`; ghost surfaces are
  supersession-aware from the same change, so retired entries stop flagging as ghosts.

## Considered options

- **Refuse and instruct** — rejected: hands the agent exactly the error-prone hand-write
  the command exists to eliminate, at the worst moment (mid-close), and can livelock under
  real multi-agent load.
- **Silent auto-continue** — rejected: the caller's believed id silently diverges from the
  record; its next targeting call and any id it reported upstream are wrong.
- **Parsed-entry adjacency** — rejected: tolerant parsing makes mangled intruder headings
  invisible, so close lines would attach under a stranger's visible heading — the exact
  orphaning canon forbids.
