import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "./generated/index.js";

const prismaDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(prismaDir, "..");
const repoRoot = path.resolve(serverDir, "..");

config({ path: path.join(serverDir, ".env") });
config({ path: path.join(repoRoot, ".env.local"), override: true });

const prisma = new PrismaClient();

const DEMO_SLUG = "demo-studio";
const SLOT_COUNT = 10;
const SLOT_MINUTES = 30;

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function nextWeekdayMorning(base: Date): Date {
  const start = new Date(base);
  start.setHours(9, 0, 0, 0);
  if (start <= base) {
    start.setDate(start.getDate() + 1);
  }
  while (start.getDay() === 0 || start.getDay() === 6) {
    start.setDate(start.getDate() + 1);
  }
  return start;
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEMO_SLUG },
    create: { name: "Demo Studio", slug: DEMO_SLUG },
    update: { name: "Demo Studio" },
  });

  await prisma.booking.deleteMany({ where: { tenantId: tenant.id } });
  await prisma.slot.deleteMany({ where: { tenantId: tenant.id } });

  const slotStart = nextWeekdayMorning(new Date());
  const slots = Array.from({ length: SLOT_COUNT }, (_, i) => {
    const startsAt = addMinutes(slotStart, i * SLOT_MINUTES);
    const endsAt = addMinutes(startsAt, SLOT_MINUTES);
    return {
      tenantId: tenant.id,
      startsAt,
      endsAt,
    };
  });

  await prisma.slot.createMany({ data: slots });

  console.log(
    `Seeded tenant "${tenant.name}" (${tenant.slug}) with ${slots.length} open slots.`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
