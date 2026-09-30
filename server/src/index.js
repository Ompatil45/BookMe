import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(serverDir, "../.env") });
dotenv.config({ path: path.join(serverDir, "../../.env.local"), override: true });
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 5000;
app.use(cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
}));
app.use(express.json());
app.get("/api/health", async (_req, res) => {
    try {
        await prisma.$queryRaw `SELECT 1`;
        res.json({ ok: true, database: "connected" });
    }
    catch {
        res.status(503).json({ ok: false, database: "disconnected" });
    }
});
app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
});
//# sourceMappingURL=index.js.map