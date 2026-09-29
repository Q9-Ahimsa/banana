# Global STATE moves to per-thread edits, not whole rebuilds

Decided (2026-09-29, ratified by Ahimsa).

Several sessions write `~/.agents/STATE.md` concurrently. The canon's original rule —
"rebuilt whole, never patched" — existed to stop per-line drift: a session that patched
only the one bullet it touched, carrying the rest forward unexamined, was exactly how the
page went stale behind the project pages it projects (the trigger for #13's freshness
stamp and `state lint --global`). But "rebuilt whole" cuts the other way too: two sessions
closing in the same window each read the page, then each rebuilds and writes back the
*entire* file from its own read — there is no compare-and-swap and no lock, so the second
write silently replaces the first session's update with whatever the second session's
stale read already had. This lost update happened for real on 2026-09-28: a session's
whole-page rebuild, based on a read taken before another session's close had landed,
overwrote the page and dropped the other session's newly added thread with no trace and
no error. The freshness stamp and lint (v1.5, ADR 0004 §Global grain) already catch a
thread that drifts behind its own project page; they do nothing for a write that erases a
sibling session's edit outright, because by the time lint runs the deleted content is
simply gone, not stale.

Adopt per-thread edits instead: at close, a session edits only the Active-threads bullets
and Backlog items it owns or changed, right after a fresh read, re-stamping each touched
thread's `(as of)` from its own source — the page is never rewritten whole. Two sessions
editing different threads in the same window now land cleanly, because each edit touches
disjoint lines rather than regenerating the file from a point-in-time snapshot of
everything. Freshness stays exactly where v1.5 already put it: the `(as of)` stamp plus
`banana state lint --global`'s `thread-stale` check, not a rebuild trigger.

## Consequences

- Drift is caught, not prevented: two per-thread edits to *different* threads in the same
  window are safe by construction, but two edits to the *same* thread in the same window
  can still race — same as any concurrent-edit-without-locking scheme. `thread-stale`
  remains the mechanical backstop for detecting the result.
- The live `~/.agents/STATE.md` header still carries the retired "rebuilt whole, never
  patched" text until an agent migrates it by hand to the new header line. The global-mode
  `retired-header` WARN (`checkRetiredHeaderGlobal`, #15) is the mechanical flag that
  catches an unmigrated page in the meantime.
- Project-grain STATE (ADR 0001's rebuild-on-close, v1.3) is unaffected — this amendment is
  global-grain only.

## Considered options

- **Compare-and-swap whole rebuilds** (read a version marker, rebuild, write only if the
  marker is unchanged) — rejected: every harness on this machine writes files its own way
  (an editor's in-place write, a hand-authored patch, a kit command), so CAS needs one
  code path enforcing check-then-write atomically, which the protocol has no way to mandate
  across harnesses. Even granting a dedicated kit write command, it would still have to
  re-read every project's STATE.md at every global close to know what to stamp — the same
  cross-file cost `state lint --global` already pays on demand, just moved onto every write
  instead.
- **Lock files** — rejected: a session that is killed or crashes mid-edit leaves a stale
  lock nobody releases, the identical failure mode that already rules out relying on a
  close-time hook elsewhere in this protocol (there is no reliable "on kill" signal to
  release it).
