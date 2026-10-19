# BookMe Agent Guidance

## Product Direction

- Treat `.cursor/plans/bookme_v2.plan.md` as the active implementation plan.
- Use `booking-saas-project-brief.txt.md` for long-term context, but do not pull v3 or later work into v2.
- Follow the active plan in order: preserve v1, implement the backend contracts, verify them, then add the dashboard.
- Keep changes small, plan-scoped, and compatible with the existing React, Express, Prisma, and Neon stack.

## Working Agreement

- Before changing code, identify the first pending plan item affected by the request.
- Review the relevant current implementation and `git diff` before suggesting or applying a fix.
- Default to suggestions during a review. Modify files only when the user asks to implement or fix the findings.
- State when editor context, unsaved text, database access, or runtime verification is unavailable; never imply it was inspected.
- Validate the narrowest affected build or test first, then broaden only when useful.
- Do not overwrite unrelated user changes.

## Code Review Rules

### Preserve the v1 booking contract

- Flag changes that make `GET /api/slots` or `POST /api/bookings` require authentication, expose booked slots, or weaken the database-backed double-booking protection.
  Safe path: keep guest booking public and preserve the unique slot constraint with the `409` response.

### Keep v2 backend-authoritative

- Flag availability or slot generation implemented only in React state, or tenant identity accepted from a protected request body.
  Safe path: persist working hours in Postgres, generate real `Slot` rows on the server, and derive the tenant from the authenticated user.

### Protect authentication secrets

- Flag raw refresh tokens stored in the database, auth tokens stored in browser local storage, distinct bad-login messages that enumerate accounts, or protected routes that skip token validation.
  Safe path: hash refresh tokens, rotate an httpOnly cookie, keep the access token in memory, and return the same `401` message for unknown users and bad passwords.

### Keep generation idempotent and timezone-safe

- Flag fixed-offset timezone math, duplicate generated slots, deletion or movement of booked slots, and generation ranges beyond the plan's 14-day limit.
  Safe path: resolve the tenant's IANA timezone, skip existing tenant/start-time pairs, preserve booked rows, and reject invalid ranges.

### Prevent v2 scope creep

- Flag additions for multiple tenants, roles, invites, payments, email, sockets, services, or public tenant slugs unless the active plan changes.
  Safe path: finish and verify the one-owner v2 loop first.

