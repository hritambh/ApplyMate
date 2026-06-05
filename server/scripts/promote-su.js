/**
 * One-time script to promote a user to superuser (su) role.
 * Usage: node --env-file=.env scripts/promote-su.js <email>
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const _require = createRequire(import.meta.url);
const _dotenv = _require('dotenv');
_dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

import prismaPkg from '@prisma/client';
const { PrismaClient } = prismaPkg;
import pgPkg from 'pg';
const { Pool } = pgPkg;
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage: node scripts/promote-su.js <email>');
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { email } });
if (!user) {
  console.error(`No user found with email: ${email}`);
  process.exit(1);
}

if (user.role === 'su') {
  console.log(`${email} is already a superuser.`);
  process.exit(0);
}

await prisma.user.update({ where: { email }, data: { role: 'su' } });
console.log(`Done — ${email} is now a superuser (su).`);
await prisma.$disconnect();
