import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(serverDir, "../.env") });
dotenv.config({ path: path.join(serverDir, "../../.env.local"), override: true });
import express from "express";
import cors from "cors";
import { z } from "zod";
import { Prisma, PrismaClient } from "../prisma/generated/index.js";

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  })
);
app.use(express.json());

const createBookingSchema = z.object({
  slotId: z.union([z.cuid(), z.cuid2(), z.uuid()]),
  guestName: z.string().trim().min(1),
  guestEmail: z.email(),
});

app.get("/api/slots", async (_req, res) => {
  const slots = await prisma.slot.findMany({
    where: { booking: { is: null } },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      tenant: { select: { name: true } },
    },
  });

  res.json(
    slots.map((slot) => ({
      id: slot.id,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      tenantName: slot.tenant.name,
    })),
  );
});

app.post("/api/bookings", async (req, res) => {
  const parsed = createBookingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  const { slotId, guestName, guestEmail } = parsed.data;

  const slot = await prisma.slot.findUnique({ where: { id: slotId } });
  if (!slot) {
    res.status(404).json({ error: "Slot not found" });
    return;
  }

  try {
    const booking = await prisma.booking.create({
      data: {
        tenantId: slot.tenantId,
        slotId: slot.id,
        guestName,
        guestEmail,
      },
    });

    res.status(201).json({
      id: booking.id,
      slotId: booking.slotId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      res.status(409).json({ error: "Slot already booked" });
      return;
    }

    throw error;
  }
});
app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: "connected" });
  } catch {
    res.status(503).json({ ok: false, database: "disconnected" });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
