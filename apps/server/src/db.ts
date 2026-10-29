import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({ log: ['warn', 'error'] });

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** BIGINT columns hold minor units; every value we write is bounded by MAX_MINOR (< 2^53). */
export const toNum = (v: bigint | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
export const toNumOrNull = (v: bigint | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
export const toBig = (v: number): bigint => BigInt(v);

/** Date-only columns are stored at UTC midnight. */
export const toDateOnly = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
export const fromDateOnly = (d: Date): string => d.toISOString().slice(0, 10);
export const fromDateOnlyOrNull = (d: Date | null | undefined): string | null => (d ? fromDateOnly(d) : null);
export const todayIso = (): string => new Date().toISOString().slice(0, 10);
