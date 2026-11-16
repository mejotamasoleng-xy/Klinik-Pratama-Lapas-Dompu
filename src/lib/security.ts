import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export const RAW_NIK_PATTERN = /^\d{16}$/;
export const DATE_STRING_PATTERN = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/;

export const nikSchema = z
  .string({ invalid_type_error: 'NIK must be a string.' })
  .trim()
  .min(16)
  .max(16)
  .regex(RAW_NIK_PATTERN, 'Invalid NIK format.');

export const dateStringSchema = z
  .string({ invalid_type_error: 'Date must be a string.' })
  .trim()
  .regex(DATE_STRING_PATTERN, 'Invalid date format.')
  .refine((value) => {
    const normalized = value.includes('/')
      ? value.split('/').reverse().join('-')
      : value;
    const date = new Date(`${normalized}T00:00:00Z`);
    return !Number.isNaN(date.getTime());
  }, 'Invalid date value.');

export const simpleTextSchema = z
  .string({ invalid_type_error: 'Text field must be a string.' })
  .trim()
  .min(1)
  .max(255);

export function getTrustedClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim().length > 0) {
    return realIp.trim();
  }

  const cloudflare = req.headers['cf-connecting-ip'];
  if (typeof cloudflare === 'string' && cloudflare.trim().length > 0) {
    return cloudflare.trim();
  }

  const clientIp = req.headers['x-client-ip'];
  if (typeof clientIp === 'string' && clientIp.trim().length > 0) {
    return clientIp.trim();
  }

  const socketAddress = req.socket?.remoteAddress;
  return socketAddress || 'unknown-client';
}

export function createApiRateLimitGuard(options: { windowMs?: number; maxRequests?: number; keyGenerator?: (req: Request) => string } = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 120;
  const map = new Map<string, { count: number; resetAt: number }>();

  const middleware = (req: Request, res: Response, next: NextFunction) => {
    const key = (options.keyGenerator ?? getTrustedClientIp)(req);
    const now = Date.now();
    const current = map.get(key) ?? { count: 0, resetAt: now + windowMs };

    if (now >= current.resetAt) {
      current.count = 0;
      current.resetAt = now + windowMs;
    }

    if (current.count >= maxRequests) {
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Silakan coba lagi nanti.' });
    }

    current.count += 1;
    map.set(key, current);
    next();
  };

  return { middleware, map, isBlocked: (req: Request) => { const key = (options.keyGenerator ?? getTrustedClientIp)(req); const now = Date.now(); const current = map.get(key); return !!current && now < current.resetAt && current.count >= maxRequests; } };
}

export function validateBody<T extends z.ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Request payload tidak valid.' });
    return null;
  }
  return parsed.data;
}

export function createGenericObjectSchema() {
  return z.object({}).passthrough();
}

export function createWbpSchema() {
  return z.object({
    id: z.string().trim().min(1).max(128).optional(),
    no: z.union([z.number(), z.string()]).optional(),
    nik: z.union([nikSchema, z.literal(''), z.null()]).optional(),
    noRegInstansi: z.union([z.string(), z.literal(''), z.null()]).optional(),
    nama: z.string().trim().min(1).max(255).optional(),
    jenisKelamin: z.string().trim().max(64).optional(),
    tempatLahir: z.string().trim().max(255).optional(),
    tanggalLahir: z.union([dateStringSchema, z.literal(''), z.null()]).optional(),
    alamat: z.string().trim().max(500).optional(),
    namaAyah: z.string().trim().max(255).optional(),
    namaIbu: z.string().trim().max(255).optional(),
    pekerjaan: z.string().trim().max(255).optional(),
    jenisKejahatan: z.string().trim().max(255).optional(),
    kategori: z.string().trim().max(128).optional(),
    lamaPidana: z.union([z.string(), z.number(), z.literal(''), z.null()]).optional(),
    tanggalMasuk: z.union([dateStringSchema, z.literal(''), z.null()]).optional(),
    tglEkspirasi: z.union([dateStringSchema, z.literal(''), z.null()]).optional(),
    blok: z.string().trim().max(128).optional(),
    kamar: z.string().trim().max(128).optional(),
    kamarSidb: z.string().trim().max(128).optional(),
    lokasiSel: z.string().trim().max(128).optional(),
    tglSuratPenahanan: z.union([dateStringSchema, z.literal(''), z.null()]).optional(),
    nomorSuratPenahanan: z.string().trim().max(128).optional(),
    statusData: z.string().trim().max(64).optional(),
    batchBpjs: z.string().trim().max(128).optional(),
    statusSkrining: z.string().trim().max(128).optional(),
    kendalaBpjs: z.string().trim().max(255).optional(),
    dasarPbi: z.string().trim().max(255).optional(),
    catatanPenggabungan: z.string().trim().max(500).optional(),
    perluDicek: z.boolean().optional(),
    sumberUpdate: z.string().trim().max(128).optional(),
    terakhirDiperbarui: z.union([dateStringSchema, z.literal(''), z.null()]).optional(),
    dibuatPada: z.union([dateStringSchema, z.literal(''), z.null()]).optional(),
  }).passthrough();
}

export function createKunjunganSchema() {
  return z.object({
    id: z.string().trim().min(1).max(128).optional(),
    tanggal: z.union([dateStringSchema, z.literal('')]).min(1).optional(),
    wbpId: z.union([z.string().trim().min(1).max(128), z.literal(''), z.null()]).optional(),
    nama: z.string().trim().min(1).max(255).optional(),
    nik: z.union([nikSchema, z.literal(''), z.null()]).optional(),
    kamar: z.string().trim().max(128).optional(),
    keluhan1: z.string().trim().max(255).optional(),
    keluhan2: z.string().trim().max(255).optional(),
    keluhan3: z.string().trim().max(255).optional(),
    penyakit1: z.string().trim().max(255).optional(),
    jenis1: z.string().trim().max(64).optional(),
    penyakit2: z.string().trim().max(255).optional(),
    jenis2: z.string().trim().max(64).optional(),
    penyakit3: z.string().trim().max(255).optional(),
    jenis3: z.string().trim().max(64).optional(),
    terapi: z.string().trim().max(255).optional(),
    dokterPemeriksa: z.string().trim().max(255).optional(),
    perawat: z.string().trim().max(255).optional(),
    catatan: z.string().trim().max(1000).optional(),
    dihapus: z.boolean().optional(),
    dibuatPada: z.union([dateStringSchema, z.literal(''), z.null()]).optional(),
    diubahPada: z.union([dateStringSchema, z.literal(''), z.null()]).optional(),
  }).passthrough();
}

export function createGenericArraySchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.array(itemSchema).default([]);
}

export const apiRateLimitGuard = createApiRateLimitGuard();
