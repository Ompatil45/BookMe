import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(serverDir, "../.env") });
dotenv.config({ path: path.join(serverDir, "../../.env.local"), override: true });

const env = z.object({
  PORT: z.string().optional(),
  CLIENT_ORIGIN: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
}).parse(process.env);

import express from "express";
import cors from "cors";
import { z } from "zod";
import { Prisma, PrismaClient } from "../prisma/generated/index.js";
import cookieParser from "cookie-parser";

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const createBookingSchema = z.object({
  slotId: z.union([z.cuid(), z.cuid2(), z.uuid()]),
  guestName: z.string().trim().min(1),
  guestEmail: z.email(),
});
const signup = z.object({
  name: z.string().trim().min(1),
  email: z.email(),
  password: z.string().trim().min(1),
})
const login = z.object({
  email: z.email(),
  password: z.string().trim().min(1),
})


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

app.post("/api/auth/signup", async (req, res) => {
  const parsed = signup.safeParse(req.body);
  if(!parsed.success){
    res.status(400).json({error: "Invalid body"});
    return;
  }

  const { password, name } = parsed.data;
  const email = parsed.data.email.toLowerCase();
  
  const existingUser = await prisma.user.findFirst();
  if(existingUser){
    res.status(409).json({error: "User already exists"});
    return;
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: "demo-studio" }});
  if(!tenant){
    res.status(500).json({error: "Tenant not found"});
    return;
  };

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(parsed.data.password),
      tenantId: tenant.id,
    }
  }
  );

  const { accessToken } = await createSession(res, user);

  res.status(201).json({ accessToken, user: { id: user.id, email: user.email }});
 
  });

app.post("api/auth/login", async (req, res) => {
  const parsed = login.safeParse(req.body);
  if(!parsed.success){
    res.status(400).json({error: "Invalid body"});
    return;
  };
  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email }});
  const ok = user && (await comparePassword(parsed.data.password, user.passwordHash));
  if(!ok){
    res.status(401).json({error: "Invalid credentials"});
    return;
  }

  const { accessToken } = await createSession(res, user);
  res.json({ accessToken });

})

app.post("api/auth/refresh", async (req, res) => {
  const raw = req.cookies.refreshToken;
  if(!raw || typeof raw != "string"){
    clearRefreshCookie(res);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const result = await rotateRefreshSession(res, raw);
  if(!result){
    clearRefreshCookie(res);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json({ accessToken: result.accessToken });
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
