import { Prisma, PrismaClient } from '@prisma/client';

// Prisma client singleton - Next.js dev hot-reload otherwise exhausts
// connections; worker + api share the same module.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Unique-constraint violation - the 409 / race-retry paths in the API layer.
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
