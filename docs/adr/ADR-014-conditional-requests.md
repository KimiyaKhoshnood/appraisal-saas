# ADR-014: Conditional requests (ETag / If-Match) against lost updates

- Status: Accepted
- Date: 2026-10-13

## Problem
An evaluation is edited by several people over days (employee, manager, approvers) and often in
several tabs. The `version` column already made each request atomic (`UPDATE … WHERE version =
$read`), but only *within* one request: a user who loaded the page at version 3 and saves after
someone else produced version 4 silently overwrote that work (the classic lost update over
"think time").

## Decision
- Single-evaluation responses carry `ETag: "v<version>"` (a core interceptor sets it from any body
  with a numeric `version`); the version is also in the body for clients that cannot read headers.
- Every write (save scores, submit, approve, reject) honours `If-Match`. A stale tag is refused
  with **412 Precondition Failed** (RFC 9110 §13.1.1) and nothing changes. `*` or no header means
  no precondition, so older clients keep working; the web client always sends it.
- The precondition is evaluated **after** read authorisation: a stranger gets the same 404 as for
  a missing evaluation (ADR-008), never a 412 that would confirm it exists.
- A malformed tag is a 400 with the field `If-Match`, like any other invalid input.
- `If-None-Match` on reads yields 304 without extra code (Express compares the ETag).
- The UI treats 412 as a normal situation: it explains that someone else changed the evaluation,
  reloads the current version and lets the user re-apply the change.

## Alternatives
Pessimistic locks or "checked out by" flags (abandoned locks, needs expiry and admin override);
last-write-wins (data loss); merging score by score (ambiguous for a state machine); requiring
`If-Match` (428) on every write (breaks existing API clients for little gain; can be enabled later).

## Consequences
Two people editing the same evaluation at the same moment is now visible instead of silent.
The cost is one integer comparison per write.

## Verification
`concurrency.e2e.spec.ts` (ETag equals body version, 304, two tabs → 412 and the first save
survives, stale tag on a transition, stranger → 404, malformed → 400, `*` and absent accepted),
`conditional.spec.ts` (parser), and a manual browser check (412 message, reload, successful save).
