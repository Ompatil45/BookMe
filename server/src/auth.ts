import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { PrismaClient, User } from "../prisma/generated/index.js";

const ACCESS_TOKEN_TTL_SEC = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

export type AuthUser = {
  id: string;
  email: string;
  tenantId: string;
};

export type AuthenticatedRequest = Request & {
  authUser?: AuthUser;
};

function accessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET is not set");
  return secret;
}

function refreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error("JWT_REFRESH_SECRET is not set");
  return secret;
}

function cookieOptions() {
  const isLocal =
    process.env.NODE_ENV !== "production" &&
    (process.env.CLIENT_ORIGIN?.includes("localhost") ?? true);
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/api/auth",
    secure: !isLocal,
  };
}

function hashRefreshToken(raw: string): string {
  return crypto
    .createHmac("sha256", refreshSecret())
    .update(raw)
    .digest("hex");
}

function signAccessToken(user: Pick<User, "id">): string {
  return jwt.sign({ sub: user.id }, accessSecret(), {
    expiresIn: ACCESS_TOKEN_TTL_SEC,
  });
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function comparePassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

function setRefreshCookie(res: Response, raw: string): void {
  res.cookie("refreshToken", raw, {
    ...cookieOptions(),
    expires: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie("refreshToken", cookieOptions());
}

export async function createSession(
  res: Response,
  user: User,
  prisma: PrismaClient,
): Promise<{ accessToken: string }> {
  const raw = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(raw),
      expiresAt,
    },
  });

  setRefreshCookie(res, raw);
  return { accessToken: signAccessToken(user) };
}

async function revokeAllLiveRefreshTokens(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function rotateRefreshSession(
  res: Response,
  raw: string,
  prisma: PrismaClient,
): Promise<{ accessToken: string } | null> {
  const tokenHash = hashRefreshToken(raw);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!existing) {
    return null;
  }

  if (existing.revokedAt) {
    await revokeAllLiveRefreshTokens(prisma, existing.userId);
    return null;
  }

  if (existing.expiresAt <= new Date()) {
    return null;
  }

  const newRaw = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.$transaction(async (tx) => {
    const replacement = await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        tokenHash: hashRefreshToken(newRaw),
        expiresAt,
      },
    });

    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: replacement.id },
    });
  });

  setRefreshCookie(res, newRaw);
  return { accessToken: signAccessToken(existing.user) };
}

export async function revokeRefreshSession(
  res: Response,
  raw: string,
  prisma: PrismaClient,
): Promise<void> {
  const tokenHash = hashRefreshToken(raw);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });

  if (existing && !existing.revokedAt) {
    await prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
  }

  clearRefreshCookie(res);
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = jwt.verify(token, accessSecret());
    if (typeof payload !== "object" || payload === null || !("sub" in payload)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const sub = payload.sub;
    if (typeof sub !== "string") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.authUser = { id: sub, email: "", tenantId: "" };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
