# Spec — #17: doctor's unowned-next audit honors supersession

Session entry: `.agents/session.log` cli.16 · Ticket: GitHub #17. Built in its own git worktree,
in parallel with #6 and #8.

## Why

Canon CONTINUITY rule 3: "An unowned `NEXT:` found in the record is a defect, not a category:
briefs and the doctor surface it for adoption, and the next session touching that stream claims
or reassigns it via a superseding entry." A superseding entry is the prescribed remedy. But
`auditProject` in `lib/doctor.mjs` exempts superseded entries only from the ghost audit, and
its comment says "unowned-NEXT and every other audit are unaffected by supersession". Closed
entries are immutable, so a malformed NEXT (`NEXT: owner - text`) in a closed entry can never be
cleared, even after the canon's remedy has been applied. Observed in the kit's own log.

## Change

In `auditProject`, the session-log unowned-NEXT loop skips entries whose
`${entry.feature}.${entry.n}` is in the `superseded` set, the same set the ghost check uses.
Correct the comment above it and cite canon rule 3. The LOGBOOK unowned-NEXT audit is
unchanged: the logbook's NEXT lines are not per-entry parsed and have no supersession
parsing.

## Tests (red-first; follow the existing doctor tests' sandbox pattern)

1. A session log with one entry whose NEXT is `NEXT: someone - do the thing` → one
   `unowned-next` finding (characterization; passes before and after).
2. The same log plus a later entry carrying `SUPERSEDES: <that feature>.<n>` and a properly
   owned NEXT → no `unowned-next` finding for the superseded entry. This must FAIL before the fix.
3. A malformed NEXT in an entry that is NOT superseded, alongside an unrelated superseded entry
   → still flagged (the exemption is per entry, not per log).
4. LOGBOOK.md with `NEXT: someone - x` → still flagged (unchanged).

Mutation check: drop the `superseded.has(...)` guard, test 2 fails, restore.

Update the `doctor` audit contract in `docs/DESIGN.md` if it states the old behavior. Touch
only the audit block and its comment in `lib/doctor.mjs`. #6 is editing `runDoctor` in the same
file in parallel; keep the diff small so the merge stays clean. Synthetic fixtures only (public
repo). Gates: `npm run check`, `npm test` (run through `rtk proxy npm test` so counts show).
