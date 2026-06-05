import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();

export async function logAudit(userId, action, entityType, entityId = null, details = null) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, entityType, entityId, details }
    });
  } catch (err) {
    console.error('Audit Log Error:', err);
  }
}