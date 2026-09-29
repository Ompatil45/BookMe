# Multi-Tenant Booking SaaS — Project Brief

**Stack:** PostgreSQL, Express, React, Node.js, TypeScript

## The Idea

A booking/scheduling platform (like Cal.com / Calendly / Acuity) where:
- A **business owner** signs up, sets their availability, and gets a public booking link.
- A **client** visits that public link (no account needed) and books an open time slot.
- Multiple businesses ("tenants") use the same app, with fully isolated data.

Two distinct user experiences on one codebase:
1. **Dashboard side** (authenticated) — manage services, availability, bookings, team.
2. **Public booking side** (unauthenticated) — view slots, book, get confirmation.

This dual-sided nature is what makes it a strong portfolio piece — it's not just CRUD.

## Reference Products (for inspiration, not copying)

- **Cal.com** — open source (github.com/calcom/cal.com), TypeScript + Prisma + Postgres. Closest match to your stack; read their schema and API structure for real patterns.
- **Calendly** — best UX reference: timezone handling, buffer times, multiple event types, public booking page flow.
- **Acuity Scheduling** — more business/service oriented: deposits, packages, intake forms. Good if you lean toward "salon/consultant" use case over "meeting scheduling."
- **Savvycal** — stretch inspiration: showing availability overlap between two people.

## Build Roadmap

### v1 — Dumbest version (single tenant, no auth)
- One hardcoded business, manually seeded time slots in DB.
- Public page lists slots, lets someone "book" one (just a DB write, no auth/payment).
- Goal: confirm the core booking flow works end-to-end.

### v2 — Real auth + your own account
- Business owner signs up / logs in (JWT + refresh tokens, bcrypt password hashing).
- Dashboard to define working hours (e.g., Mon–Fri 9–5) and slot duration.
- Auto-generate available slots from working hours — includes timezone handling.

### v3 — Multi-tenancy
- Multiple businesses sign up, each gets a public URL (`/book/business-slug`).
- All data scoped by `tenant_id` — enforced at the query/middleware level.
- Team invites with roles (admin / staff).

### v4 — Payments + polish
- Stripe integration for deposit or full payment on booking.
- Stripe webhooks (payment succeeded/failed, subscription events).
- Email confirmations (Resend/SendGrid) to business + client.
- Cancellation / rescheduling flow.
- Buffer time between bookings, blocked-off dates.

### v5 — Stretch goals (pick 1–2, not all)
- Real-time slot updates via WebSockets (Socket.io) — a slot disappears live if someone else books it while you're viewing.
- Google Calendar sync via OAuth + Calendar API.
- SMS reminders (Twilio).

## The Hardest, Most Interview-Worthy Problem

**Preventing double-booking under concurrent requests.** Two people click "book" on the same slot near-simultaneously — the DB must guarantee only one wins. Solve via a unique constraint on `(slot_id, tenant_id)` or a transaction with row-level locking. This is a genuinely strong interview story: "I handled a race condition where two users could book the same slot," vs. generic CRUD talk.

## Full Skill Checklist

### Backend (Node + Express + TypeScript)
- Express routing & middleware (auth middleware, error handling, tenant-scoping middleware)
- Strong typing: interfaces for req/res shapes, generics for reusable service functions, no `any`
- Config management (`.env`, validated with Zod)
- RESTful API design (or tRPC for end-to-end type safety)
- Input validation on every route (Zod)
- Centralized error handling, custom error classes

### Database (PostgreSQL)
- Relational schema: tenants → users → services → availability → bookings
- Tenant isolation: `tenant_id` column + filtering on every query, or Postgres Row-Level Security (RLS) — RLS is a strong interview talking point
- Indexes, especially on `tenant_id` + frequently filtered columns
- Migrations via Prisma or Drizzle ORM
- Transactions (e.g., booking + payment record must succeed/fail together)

### Auth & Security
- Password hashing (bcrypt/argon2)
- JWT access tokens + refresh token rotation (httpOnly cookies, not localStorage)
- Role-based access control (admin/staff)
- Tenant resolution middleware (figure out "which tenant" before touching data)
- Rate limiting (express-rate-limit), helmet, proper CORS config

### Payments
- Stripe Checkout or Elements
- Stripe webhooks with signature verification + idempotency handling

### Frontend (React + TypeScript)
- TanStack Query for server state (caching, refetching, optimistic updates)
- React Hook Form + Zod for forms (ideally sharing schemas with backend)
- Protected routes, role-based UI rendering
- Clean component architecture (presentational vs. container logic)

### DevOps / Production
- Deploy: backend on Render/Railway, frontend on Vercel, DB on Neon/Supabase/Railway
- GitHub Actions CI (lint + tests on push)
- Basic structured logging
- Testing: integration tests on API routes (Vitest/Jest + Supertest), some frontend tests (React Testing Library)

### Nice-to-haves
- PDF generation (e.g., booking confirmations/receipts)
- Background jobs (BullMQ + Redis) — e.g., reminder emails before appointments

## Suggested Sequencing (don't learn everything upfront)

1. Single-tenant CRUD, no auth — get the domain logic working
2. Add auth (JWT, bcrypt, protected routes)
3. Add tenant model, scope everything to `tenant_id`
4. Add roles/permissions within a tenant
5. Add Stripe
6. Add tests, deploy, polish

**Core principle:** build the dumbest working version first, let real walls (slow query, broken token refresh, race condition) tell you what to learn deeply next, then refactor. Don't wait to "feel ready" before starting.
