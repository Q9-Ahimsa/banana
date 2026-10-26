# Spec — CONTINUITY v1.9: delivered, review optional, is closed (release 0.7.1)

## Owner ruling (2026-10-26)
Approved: "Add a close disposition: delivered, review optional. It writes a
Recently-closed line with the artifact path. It does not create a 'waiting on
<owner>' thread." Ship mode: build and push, then `banana sync`.

## Why
Optional reviews were written as owner-owned waiting threads. They filled the
global page with obligations nobody asked to carry: on 2026-10-26 every Active
thread waited on the owner, and 7 of 13 were optional "look at it" reviews.

## Scaffolding rule (pain + what gets deleted)
- Pain: the global page is "always full" of owner obligations.
- Deleted: the word "review" from the waiting-form scope, and the close-duty
  sentence (replaced one-for-one). Net live rule count: 0. No CLI change: the
  existing `banana state archive --reason closed` path already does the move.

## Edits — `canon/CONTINUITY.md` (CRLF in the repo; keep CRLF; rewrapping is fine, tests flatten whitespace)
| # | Where | Old | New |
|---|---|---|---|
| C0 | lines 1–2 | `<!-- banana:canon rev 1.8 -->` and the title's `— v1.8` | `rev 1.9` and `— v1.9` |
| C1 | Session close, ~line 121 | `When your thread's next step becomes someone else's, write it in the waiting form.` | `When your thread's work is delivered and nothing further waits on anyone's answer, it is finished even if the owner may still look at it: close it (see "closed" under "The archive move"); only a next step that waits on someone else's answer takes the waiting form.` |
| C2 | Waiting form, ~line 155 | `(the owner's review, ruling or action, or an outside party)` | `(the owner's ruling or action, or an outside party)` |
| C3 | archive reasons, ~line 227 | `` `closed` (a finished Active thread: archive its line, add a Recently-closed line) `` | `` `closed` (a finished Active thread: archive its line, add a Recently-closed line; for delivered work that line reads `**name** (closed YYYY-MM-DD) — delivered, review optional: {artifact path} → pointer`, and a delivery that never had an Active line just gets that line) `` |
| C4 | append after changelog item 18 | — | block below |

C4:
```
v1.9 amends the **global-grain close disposition** (owner ruling). Nothing
else changes.

19. **Delivered, review optional, is closed** — a thread whose work is
    delivered and on whose answer nothing further waits is finished: it
    leaves Active threads via `--reason closed` and gets a Recently-closed
    line naming the artifact, which expires on the usual 8-day clock and is
    then archived `expired` on sight by any session. The waiting form now
    covers only a ruling, an action or an outside party. Counter-failure:
    optional reviews kept as owner-owned waiting threads filled the page
    with obligations nobody had asked to carry.
```
Constraints: the canon must never contain the owner's name or a `C:\` path
(`FORBIDDEN_PATTERNS`, `test/canon.test.mjs`). Leave the embedded header template
(~lines 89–112) untouched; a test pins it against `templates/global-STATE.md`.

## Other files
- `test/canon.test.mjs`: `EXPECTED_REVS` `'CONTINUITY.md': '1.8'` → `'1.9'`; move the
  `'— v1.8'` title assertion out of the v1.8 test into a new test "CONTINUITY.md
  carries the v1.9 delivered close (owner ruling)" (the comment above the v1.8
  test says the newest amendment's test owns the title); update the pinned strings
  that quote C1's old sentence and C3's old definition; the new test pins `— v1.9`,
  the C4 intro, the item-19 title, C1, C3, and asserts `the owner's review, ruling or
  action` is absent.
- `docs/DESIGN.md` (~line 803) restates the `closed` definition: update it to C3.
  Leave historical v1.8 mentions in CONTEXT.md / DESIGN.md as they are.
- `package.json` + `package-lock.json`: 0.7.0 → 0.7.1 (doctor compares versions).

## Gates
`npm run check && npm test` from the repo root, all green. Then:
`grep -c "review optional" canon/CONTINUITY.md` ≥ 2;
`grep -c "the owner's review, ruling or action" canon/CONTINUITY.md` = 0.

## Commits (main session commits after review)
1. `docs(canon): CONTINUITY v1.9 — delivered, review optional, is closed`
2. `chore(release): 0.7.1`
