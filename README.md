# BookMe

BookMe is a booking and scheduling SaaS built with TypeScript. A business owner can create an account, configure weekly working hours, choose a slot length and timezone, and generate upcoming availability. Guests can browse and reserve open slots without creating an account.

The project is an npm workspace with separate React and Express applications. PostgreSQL is hosted on Neon and accessed through Prisma.

## Features

- Owner signup, login, logout, and session restoration
- Short-lived JWT access tokens with rotating httpOnly refresh cookies
- Persistent weekly working hours, IANA timezone, and slot duration settings
- Server-side, timezone-aware slot generation for ranges of up to 14 days
- Idempotent generation that preserves existing and booked slots
- Public listing and guest booking of available slots
- Database-backed double-booking protection with a `409` response
- Zod validation for API request bodies
- API and database health checks

## Tech stack

- **Client:** React 19, TypeScript, Vite, React Router, Axios
- **Server:** Node.js, Express 5, TypeScript, Zod, JWT, bcrypt
- **Database:** PostgreSQL on Neon
- **ORM:** Prisma 6

## Project structure

```text
BookMe/
|-- client/                 # React/Vite public booking page and owner dashboard
|   `-- src/
|-- server/                 # Express API
|   |-- prisma/             # Schema, migrations, generated client, and seed
|   |-- scripts/            # Environment-aware Prisma runner
|   `-- src/                # Public booking, auth, and availability APIs
|-- booking-saas-project-brief.txt.md
|-- package.json            # Workspace scripts
`-- tsconfig.json
```

## Prerequisites

- Node.js 20 or newer
- npm
- A PostgreSQL database (the project is configured for Neon)

## Getting started

1. Install dependencies from the repository root:

   ```bash
   npm install
   ```

2. Configure the database connection. Either use the Neon CLI from the repository root:

   ```bash
   neon env pull
   ```

   Or copy `server/.env.example` to `server/.env` and configure the server:

   ```env
   DATABASE_URL="postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require"
   PORT=5000
   CLIENT_ORIGIN="http://localhost:5173"
   JWT_ACCESS_SECRET="replace-with-a-long-random-secret"
   JWT_REFRESH_SECRET="replace-with-a-different-long-random-secret"
   ```

   The server and Prisma scripts load `server/.env` first, then root `.env.local`. Values in `.env.local` take precedence.

3. Apply the database migrations:

   ```bash
   npm run prisma:migrate -w server
   ```

4. Seed the demo tenant and initial public slots:

   ```bash
   npm run prisma:seed -w server
   ```

   The seed does not create an owner password. Create the single v2 owner through the signup page or API.

5. Start the client and server together:

   ```bash
   npm run dev
   ```

The client runs at `http://localhost:5173` and the API runs at `http://localhost:5000` by default.

## Application routes

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | Public | Browse and book available slots |
| `/signup` | Public | Create the v2 owner account |
| `/login` | Public | Sign in as the owner |
| `/dashboard` | Owner | Configure availability and generate slots |

The dashboard stores the access token only in memory. On reload, it restores the session through the rotating httpOnly refresh cookie.

## Available scripts

Run these commands from the repository root.

| Command | Description |
| --- | --- |
| `npm run codex` | Open Codex CLI with an available model for the signed-in account |
| `npm run codex:astra` | Request GPT-6 Astra explicitly when the account has access |
| `npm run review` | Review all uncommitted changes against the active BookMe plan |
| `npm run dev` | Start all workspace development servers |
| `npm run dev:client` | Start only the Vite client |
| `npm run dev:server` | Start only the Express API |
| `npm run build -w client` | Build the client for production |
| `npm run build -w server` | Compile the server |
| `npm run start -w server` | Run the compiled server |
| `npm run prisma:generate -w server` | Generate the Prisma client |
| `npm run prisma:migrate -w server` | Create or apply a development migration |
| `npm run prisma:seed -w server` | Reset and seed the demo tenant and slots |
| `npm run prisma:studio -w server` | Open Prisma Studio |

## API

### Public endpoints

#### `GET /api/health`

Checks whether the API can connect to PostgreSQL.

#### `GET /api/slots`

Returns unbooked slots ordered by start time. No authentication is required.

```json
[
  {
    "id": "slot-id",
    "startsAt": "2026-10-23T03:30:00.000Z",
    "endsAt": "2026-10-23T04:00:00.000Z",
    "tenantName": "Demo Studio"
  }
]
```

#### `POST /api/bookings`

Books an available slot without requiring an account.

```json
{
  "slotId": "slot-id",
  "guestName": "Ada Lovelace",
  "guestEmail": "ada@example.com"
}
```

The endpoint returns `201` when the booking succeeds, `400` for invalid input, `404` when the slot does not exist, and `409` if another guest has already booked it.

### Authentication endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create the single owner and start a session |
| `POST` | `/api/auth/login` | Authenticate the owner and start a session |
| `POST` | `/api/auth/refresh` | Rotate the refresh cookie and return a new access token |
| `POST` | `/api/auth/logout` | Revoke the refresh token and clear the cookie |
| `GET` | `/api/me` | Return the authenticated owner and tenant identifiers |

Signup returns `201`; attempting to create another owner returns `409`. Login failures use the same `401` response for unknown accounts and incorrect passwords.

Refresh tokens are random values stored only in an httpOnly cookie. The database stores their hashes, and each successful refresh revokes and replaces the presented token. Send the returned access token as `Authorization: Bearer <token>` when calling protected endpoints.

### Availability endpoints

#### `GET /api/availability`

Returns the authenticated owner's timezone, slot duration, and weekly rules.

```json
{
  "timezone": "Asia/Kolkata",
  "slotMinutes": 30,
  "rules": [
    { "weekday": 1, "startMin": 540, "endMin": 1020 }
  ]
}
```

#### `PUT /api/availability`

Replaces the authenticated owner's weekly rules and saves the timezone and slot duration. Supported durations are `15`, `30`, `45`, and `60` minutes. Closed days are omitted from `rules`.

#### `POST /api/slots/generate`

Generates slots from saved availability for an inclusive local-date range of at most 14 days.

```json
{
  "from": "2026-10-26",
  "to": "2026-11-01"
}
```

Generation uses the tenant's IANA timezone, skips past and duplicate start times, and never deletes or moves booked slots. A successful response returns `201` with `{ "created": number }`.

All availability endpoints require a valid bearer access token. The tenant is derived from the authenticated user and is never accepted from the request body.

## Codex in the IDE

This repository includes [`.codex/config.toml`](./.codex/config.toml), which is shared by the Codex IDE extension and Codex CLI.

- The repository's `AGENTS.md` and `$bookme-review` skill make reviews follow the active project plan and protect the public booking contract.
- In the Codex sidebar, run `/ide-context` so Codex can use the active editor context you allow. It does not capture raw keystrokes or hidden unsaved text.
- Run `/review` for an inline review of uncommitted changes, or run `npm run review` in the terminal.
- Sign in through the Codex extension or run `codex login` if prompted.

## Development status

BookMe v2 is complete. It supports the full one-owner workflow: authentication, persisted working hours, timezone-safe slot generation, a protected dashboard, and the unchanged public guest booking flow.

The next planned milestone is v3: multiple businesses, public tenant slugs, and tenant-scoped queries. Roles, invitations, payments, email, live updates, services, and calendar integrations remain out of scope for v2.
