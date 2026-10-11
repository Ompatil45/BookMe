# BookMe

BookMe is an in-progress booking and scheduling SaaS built with TypeScript. The current version provides a small end-to-end booking API: businesses can expose available time slots, and guests can reserve a slot without creating an account.

The project is structured as an npm workspace with separate React and Express applications. PostgreSQL is hosted on Neon and accessed through Prisma.

## Current features

- List all unbooked time slots
- Create a guest booking for an available slot
- Prevent double-booking with a unique database constraint
- Validate booking requests with Zod
- Check API and database health
- Seed a demo business with 10 upcoming 30-minute slots
- Proxy client-side `/api` requests to the local server

## Tech stack

- **Client:** React 19, Vite, TypeScript, React Router, Axios
- **Server:** Node.js, Express 5, TypeScript, Zod
- **Database:** PostgreSQL on Neon
- **ORM:** Prisma 6

## Project structure

```text
BookMe/
|-- client/                 # React/Vite application
|   `-- src/
|-- server/                 # Express API
|   |-- prisma/             # Schema, migrations, generated client, and seed
|   |-- scripts/            # Environment-aware Prisma runner
|   `-- src/
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

   Or copy `server/.env.example` to `server/.env` and replace the placeholder connection string:

   ```env
   DATABASE_URL="postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require"
   PORT=5000
   CLIENT_ORIGIN="http://localhost:5173"
   ```

   The server and Prisma scripts load `server/.env` first, then root `.env.local`. Values in `.env.local` take precedence.

3. Apply the database migrations:

   ```bash
   npm run prisma:migrate -w server
   ```

4. Seed the demo tenant and its available slots:

   ```bash
   npm run prisma:seed -w server
   ```

5. Start the client and server together:

   ```bash
   npm run dev
   ```

The client runs at `http://localhost:5173` and the API runs at `http://localhost:5000` by default.

## Available scripts

Run these commands from the repository root.

| Command | Description |
| --- | --- |
| `npm run dev` | Start all workspace development servers |
| `npm run dev:client` | Start only the Vite client |
| `npm run dev:server` | Start only the Express API |
| `npm run build -w client` | Build the client for production |
| `npm run build -w server` | Compile the server |
| `npm run start -w server` | Run the compiled server |
| `npm run prisma:generate -w server` | Generate the Prisma client |
| `npm run prisma:migrate -w server` | Create/apply a development migration |
| `npm run prisma:seed -w server` | Reset and seed the demo tenant's slots |
| `npm run prisma:studio -w server` | Open Prisma Studio |

## API

### `GET /api/health`

Checks whether the API can connect to PostgreSQL.

### `GET /api/slots`

Returns available slots ordered by start time.

```json
[
  {
    "id": "slot-id",
    "startsAt": "2026-10-12T03:30:00.000Z",
    "endsAt": "2026-10-12T04:00:00.000Z",
    "tenantName": "Demo Studio"
  }
]
```

### `POST /api/bookings`

Books an available slot.

```json
{
  "slotId": "slot-id",
  "guestName": "Ada Lovelace",
  "guestEmail": "ada@example.com"
}
```

The endpoint returns `201` when the booking succeeds, `400` for invalid input, `404` when the slot does not exist, and `409` if another guest has already booked it.

## Development status

BookMe is currently at the first stage described in [the project brief](./booking-saas-project-brief.txt.md): a simple booking flow with a seeded business and no authentication. The planned direction includes business accounts, generated availability, tenant-scoped data, team roles, payments, notifications, and calendar integrations.

The React client is still an early scaffold; the server API and initial database schema contain the main implemented functionality.
