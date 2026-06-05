import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load .env before anything reads process.env — must run before Pool init
const _require = createRequire(import.meta.url);
const _dotenv = _require('dotenv');
const _dir = dirname(fileURLToPath(import.meta.url));
_dotenv.config({ path: resolve(_dir, '../.env') });

// 1. Import default and destructure for Prisma
import prismaPkg from '@prisma/client';
const { PrismaClient } = prismaPkg;

// 2. Import default and destructure for pg (Postgres driver)
import pgPkg from 'pg';
const { Pool } = pgPkg;

import { PrismaPg } from '@prisma/adapter-pg';

// Set up the standard Postgres connection pool using your Neon DB URL
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// Initialize Prisma with the adapter
export const prisma = new PrismaClient({ adapter });

export async function logAudit(userId, action, entityType, entityId = null, details = null) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, entityType, entityId, details }
    });
  } catch (err) {
    console.error('Audit Log Error:', err);
  }
}