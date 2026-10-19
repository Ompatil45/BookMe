---
name: bookme-review
description: Review BookMe code and in-progress edits against the active Cursor v2 plan and repository invariants. Use when the user asks to watch, inspect, review, check, validate, or suggest changes for BookMe code, a local diff, an active editor file, a commit, or a plan step.
---

# BookMe Review

## Gather Context

1. Read `AGENTS.md` and `.cursor/plans/bookme_v2.plan.md`.
2. Read only the relevant sections of `booking-saas-project-brief.txt.md` when long-term intent is needed.
3. Inspect `git status`, the requested diff or files, and nearby code paths.
4. Use IDE context when supplied. Treat unsaved text as unseen unless it is present in the conversation or editor context.
5. Identify the first pending v2 plan item touched by the change.

## Review

- Review only by default. Do not edit files unless the user asks to apply fixes.
- Prioritize correctness, security, data integrity, regressions, and missing verification over style.
- Trace behavior across client, API, Prisma schema, and database constraints when a change crosses layers.
- Check every finding against the active plan and current code before reporting it.
- Avoid speculative findings. If evidence is incomplete, label the item as a question or verification gap.
- Ignore unrelated pre-existing issues unless they block the requested plan step.

## BookMe Invariants

- Keep public slot listing and guest booking unauthenticated.
- Preserve database-enforced double-booking protection and the `409` contract.
- Keep v2 single-tenant and one-owner; do not introduce v3 concepts.
- Persist availability and generate slots on the server, not in browser-only state.
- Derive tenant scope from the authenticated user on protected routes.
- Store only hashed refresh tokens and rotate the httpOnly refresh cookie.
- Keep access tokens out of local storage.
- Use IANA timezone conversion and preserve booked slots during generation.
- Validate every new request body with Zod.

## Report

Return:

1. A one-sentence summary of plan alignment.
2. Actionable findings ordered by severity (`P0` through `P3`) with file and line references, trigger, impact, and safe fix.
3. Missing tests or runtime checks.
4. The single best next plan-aligned change.

If there are no findings, say so directly and list any verification not performed.

