# ADR-008: 404, not 403, for resources of another tenant (and outside one's scope)

- Status: Accepted
- Date: 2026-10-07

## Problem
A 403 for "exists but is not yours" tells an attacker that the identifier exists (enumeration, T11).

## Decision
The API returns the identical body for "does not exist" and "belongs to someone else":
`404 NOT_FOUND`, same `type`, `title` and `detail` (only `requestId` differs). With RLS this is
natural: the row is simply invisible. A composite-FK violation caused by a foreign reference is
mapped to the same 404. Each such 404 on a tenant resource is recorded as
`security.resource_not_found` (route, entity, id) so probing is visible in the audit log.

## Alternatives
403: more precise for debugging, but leaks existence.

## Consequences
Debugging relies on the security log and the request id in every problem response. Attack
detection is based on unusual volumes of 404s, since one request alone cannot be classified.

## Verification
The isolation matrix asserts 404 `NOT_FOUND` on every parameterised route and byte-equal bodies
(minus `requestId`) for foreign and missing ids; it also asserts the security events exist.
