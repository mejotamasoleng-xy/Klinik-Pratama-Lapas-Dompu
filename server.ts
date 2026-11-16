/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import helmet from 'helmet';
// cors handled inline
import { z } from 'zod';
import { checkDatabaseHealth, db } from './src/db/index.ts';
import { users, rateLimitState } from './src/db/schema.ts';
import { eq } from 'drizzle-orm';
import {
  getAllWbp,
  upsertWbpSingle,
  upsertWbpBatch,
  deleteWbpById,
  clearAllWbpFromDb,
  getAllKunjungan,
  insertKunjungan,
  updateKunjunganById,
  insertKunjunganBatch,
  clearAllKunjunganFromDb,
  softDeleteKunjungan,
  restoreKunjunganById,
  permanentDeleteKunjunganById,
  getAllPenyakit,
  upsertPenyakit,
  getAllReferensi,
  upsertReferensi,
  deleteReferensiById,
  updateReferensiJenisByPenyakit,
  getSetting,
  setSetting,
  getAuditLogs,
  addAuditLog,
  getSidbHistoryList,
  addSidbHistoryEntry,
  seedPenyakitIfEmpty,
  seedReferensiIfEmpty,
  seedWbpIfEmpty,
  seedKunjunganIfEmpty,
  seedMasterObatIfEmpty,
  getAllMasterObat,
  upsertMasterObat,
  deleteMasterObatById,
  getAllResepObat,
  replaceResepForKunjungan,
  deleteResepByKunjunganId,
  replaceReferensiBatch,
  replacePenyakitBatch,
  replaceMasterObatBatch,
  restoreAllTables,
  getSharedSyncVersion,
  touchSharedSyncVersion,
  type WbpInsert,
  type KunjunganInsert,
  type ReferensiInsert,
  type PenyakitInsert,
  type SidbHistoryInsert,
  type AuditLogInsert,
  type MasterObatInsert,
  type ResepObatInsert,
} from './src/db/queries.ts';
import { requireAuth, requireRoles, ensureDestructiveAllowed, rejectIfMustChangePassword, type AuthRequest } from './src/middleware/auth.ts';
import { getTrustedClientIp, validateBody } from './src/lib/security.ts';
import { hashPasswordServer } from './src/lib/password.ts';
import { signSessionToken, verifySessionToken, verifyScryptOrLegacy } from './src/lib/server-auth.ts';
import { findUserByUsername, findUserByUid, listUsers, createOrUpdateUser, ensureBootstrapAdmin } from './src/lib/user-store.ts';
import { auditServer } from './src/lib/audit-server.ts';
import {
  INITIAL_KUNJUNGAN,
  INITIAL_MASTER_OBAT,
  INITIAL_PENGATURAN,
  INITIAL_PENYAKIT,
  INITIAL_REFERENSI,
  INITIAL_WBP,
} from './src/data/initialData.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 3000;

const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  let allow: string | null = null;
  if (!origin) {
    // same-origin/non-browser
  } else if (allowedOrigins.length === 0) {
    if (!isProd) allow = origin;
  } else if (allowedOrigins.includes(origin)) {
    allow = origin;
  }
  if (allow) {
    res.setHeader('Access-Control-Allow-Origin', allow);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Client-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '1mb' }));

app.use('/api', (req, res, next) => {
  if (req.path !== '/events') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

const rlMemory = new Map<string, { count: number; windowStart: number }>();
async function rateLimitDb(key: string, windowMs: number, max: number): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = Date.now();
  if (!db) {
    const cur = rlMemory.get(key);
    if (!cur || now - cur.windowStart >= windowMs) {
      rlMemory.set(key, { count: 1, windowStart: now });
      return { allowed: true };
    }
    cur.count += 1;
    if (cur.count > max) return { allowed: false, retryAfter: Math.ceil((cur.windowStart + windowMs - now) / 1000) };
    return { allowed: true };
  }
  try {
    const rows = await db.select().from(rateLimitState).where(eq(rateLimitState.key, key));
    const cur: any = rows[0];
    if (!cur || now - Number(cur.windowStart) >= windowMs) {
      await db.insert(rateLimitState).values({ key, count: 1, windowStart: now, updatedAt: new Date() })
        .onConflictDoUpdate({ target: rateLimitState.key, set: { count: 1, windowStart: now, updatedAt: new Date() } });
      return { allowed: true };
    }
    const newCount = Number(cur.count) + 1;
    await db.update(rateLimitState).set({ count: newCount, updatedAt: new Date() }).where(eq(rateLimitState.key, key));
    if (newCount > max) return { allowed: false, retryAfter: Math.ceil((Number(cur.windowStart) + windowMs - now) / 1000) };
    return { allowed: true };
  } catch {
    const cur = rlMemory.get(key);
    if (!cur || now - cur.windowStart >= windowMs) { rlMemory.set(key, { count: 1, windowStart: now }); return { allowed: true }; }
    cur.count += 1;
    if (cur.count > max) return { allowed: false, retryAfter: Math.ceil((cur.windowStart + windowMs - now) / 1000) };
    return { allowed: true };
  }
}

function makeRateLimiter(windowMs: number, max: number, prefix: string) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = getTrustedClientIp(req);
    const key = `${prefix}:${ip}`;
    const r = await rateLimitDb(key, windowMs, max);
    if (!r.allowed) {
      res.setHeader('Retry-After', String(r.retryAfter || 60));
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi nanti.', retryAfter: r.retryAfter });
    }
    next();
  };
}

const apiLimiter = makeRateLimiter(60_000, 180, 'api');
const loginLimiter = makeRateLimiter(60_000, 8, 'login');
app.use('/api', apiLimiter);

const jsonLarge = express.json({ limit: '50mb' });

function requireConfirm(phrase: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const body: any = req.body || {};
    if (String(body.confirm || '').trim() !== phrase) {
      return res.status(400).json({ error: `Konfirmasi diperlukan. Ketik "${phrase}" untuk melanjutkan.` });
    }
    next();
  };
}

function blockInProduction(action: string) {
  return (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (isProd) return res.status(403).json({ error: `${action} dinonaktifkan di lingkungan produksi.` });
    next();
  };
}

const authChain = [requireAuth, rejectIfMustChangePassword] as any[];
const adminDestructive = [requireAuth, rejectIfMustChangePassword, requireRoles('admin')];
const readMedical = [requireAuth, rejectIfMustChangePassword, requireRoles('admin', 'dokter_perawat', 'petugas_administrasi')];
const writeMedical = [requireAuth, rejectIfMustChangePassword, requireRoles('admin', 'dokter_perawat')];
const writeAdminOrMed = [requireAuth, rejectIfMustChangePassword, requireRoles('admin', 'dokter_perawat', 'petugas_administrasi')];

function parseOr400<T extends z.ZodTypeAny>(schema: T, req: express.Request, res: express.Response): z.infer<T> | null {
  const p = schema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'Data tidak valid.', issues: p.error.issues.slice(0,5) }); return null; }
  return p.data;
}

const wbpBodySchema = z.object({}).passthrough();
const kunjunganBodySchema = z.object({}).passthrough();
const genericArraySchema = z.array(z.any());


// ============================================================================
// REAL-TIME MULTI-DEVICE BROADCAST (SSE + DB-SHARED VERSION)
// ============================================================================
let syncVersion = Date.now();
const sseClients = new Set<express.Response>();

async function broadcastSync(scope: string, sourceClientId?: string) {
  syncVersion = await touchSharedSyncVersion(scope);
  const payload = JSON.stringify({
    type: 'sync',
    version: syncVersion,
    scope,
    sourceClientId: sourceClientId || null,
    timestamp: new Date().toISOString(),
  });
  for (const client of sseClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

app.get('/api/events', ...authChain, (req: any, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(
    `data: ${JSON.stringify({ type: 'connected', version: syncVersion, timestamp: new Date().toISOString() })}\n\n`
  );

  const keepAlive = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(keepAlive);
      sseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// ============================================================================
// DATA MAPPERS (DB <-> API/Frontend Canonical Shapes)
// ============================================================================
function mapWbpFromClient(w: any): WbpInsert {
  return {
    id: String(w.id),
    no: w.no !== undefined && w.no !== null ? Number(w.no) : null,
    nik: w.nik ?? '',
    noRegInstansi: w.no_reg_instansi ?? w.noRegInstansi ?? '',
    nama: String(w.nama || ''),
    jenisKelamin: w.jenis_kelamin ?? w.jenisKelamin ?? 'Laki-laki',
    tempatLahir: w.tempat_lahir ?? w.tempatLahir ?? '',
    tanggalLahir: w.tanggal_lahir ?? w.tanggalLahir ?? '',
    alamat: w.alamat ?? '',
    namaAyah: w.nama_ayah ?? w.namaAyah ?? '',
    namaIbu: w.nama_ibu ?? w.namaIbu ?? '',
    pekerjaan: w.pekerjaan ?? '',
    jenisKejahatan: w.jenis_kejahatan ?? w.jenisKejahatan ?? '',
    kategori: w.kategori ?? 'Narapidana',
    lamaPidana: w.lama_pidana ?? w.lamaPidana ?? '',
    tanggalMasuk: w.tanggal_masuk ?? w.tanggalMasuk ?? '',
    tglEkspirasi: w.tgl_ekspirasi ?? w.tglEkspirasi ?? '',
    blok: w.blok ?? '',
    kamar: w.kamar ?? '',
    kamarSidb: w.kamar_sidb ?? w.kamarSidb ?? w.kamar ?? '',
    lokasiSel: w.lokasi_sel ?? w.lokasiSel ?? '',
    tglSuratPenahanan: w.tgl_surat_penahanan ?? w.tglSuratPenahanan ?? '',
    nomorSuratPenahanan: w.nomor_surat_penahanan ?? w.nomorSuratPenahanan ?? '',
    statusData: w.status_data ?? w.statusData ?? 'Aktif',
    batchBpjs: w.batch_bpjs ?? w.batchBpjs ?? 'Belum masuk batch',
    statusSkrining: w.status_skrining ?? w.statusSkrining ?? '',
    kendalaBpjs: w.kendala_bpjs ?? w.kendalaBpjs ?? '',
    dasarPbi: w.dasar_pbi ?? w.dasarPbi ?? '',
    catatanPenggabungan: w.catatan_penggabungan ?? w.catatanPenggabungan ?? '',
    perluDicek: Boolean(w.perlu_dicek ?? w.perluDicek ?? false),
    sumberUpdate: w.sumber_update ?? w.sumberUpdate ?? '',
    terakhirDiperbarui: w.terakhir_diperbarui ?? w.terakhirDiperbarui ?? '',
    dibuatPada: w.dibuat_pada ?? w.dibuatPada ?? '',
  };
}

function mapWbpToClient(dw: any, idx: number) {
  return {
    id: dw.id,
    no: dw.no ?? idx + 1,
    nik: dw.nik || '',
    no_reg_instansi: dw.noRegInstansi || '',
    nama: dw.nama,
    jenis_kelamin: dw.jenisKelamin || 'Laki-laki',
    tempat_lahir: dw.tempatLahir || '',
    tanggal_lahir: dw.tanggalLahir || '',
    alamat: dw.alamat || '',
    nama_ayah: dw.namaAyah || '',
    nama_ibu: dw.namaIbu || '',
    pekerjaan: dw.pekerjaan || '',
    jenis_kejahatan: dw.jenisKejahatan || '',
    kategori: dw.kategori || 'Narapidana',
    lama_pidana: dw.lamaPidana || '',
    tanggal_masuk: dw.tanggalMasuk || '',
    tgl_ekspirasi: dw.tglEkspirasi || '',
    blok: dw.blok || '',
    kamar: dw.kamar || '',
    kamar_sidb: dw.kamarSidb || dw.kamar || '',
    lokasi_sel: dw.lokasiSel || '',
    tgl_surat_penahanan: dw.tglSuratPenahanan || '',
    nomor_surat_penahanan: dw.nomorSuratPenahanan || '',
    status_data: dw.statusData || 'Aktif',
    batch_bpjs: dw.batchBpjs || 'Belum masuk batch',
    status_skrining: dw.statusSkrining || '',
    kendala_bpjs: dw.kendalaBpjs || '',
    dasar_pbi: dw.dasarPbi || '',
    catatan_penggabungan: dw.catatanPenggabungan || '',
    perlu_dicek: Boolean(dw.perluDicek),
    sumber_update: dw.sumberUpdate || '',
    terakhir_diperbarui: dw.terakhirDiperbarui || '',
    dibuat_pada: dw.dibuatPada || (dw.createdAt ? new Date(dw.createdAt).toISOString() : ''),
  };
}

function mapKunjunganFromClient(k: any): KunjunganInsert {
  return {
    id: String(k.id),
    tanggal: String(k.tanggal || ''),
    wbpId: k.wbp_id ?? k.wbpId ?? null,
    nama: String(k.nama || ''),
    nik: k.nik ?? '',
    kamar: k.kamar ?? '',
    keluhan1: k.keluhan1 ?? '',
    keluhan2: k.keluhan2 ?? '',
    keluhan3: k.keluhan3 ?? '',
    penyakit1: k.penyakit1 ?? '',
    jenis1: k.jenis1 ?? '',
    penyakit2: k.penyakit2 ?? '',
    jenis2: k.jenis2 ?? '',
    penyakit3: k.penyakit3 ?? '',
    jenis3: k.jenis3 ?? '',
    terapi: k.terapi ?? '',
    dokterPemeriksa: k.dokter_pemeriksa ?? k.dokterPemeriksa ?? '',
    perawat: k.perawat ?? '',
    catatan: k.catatan ?? '',
    dihapus: Boolean(k.dihapus ?? false),
    dibuatPada: k.dibuat_pada ?? k.dibuatPada ?? new Date().toISOString(),
    diubahPada: k.diubah_pada ?? k.diubahPada ?? null,
  };
}

function mapKunjunganToClient(dk: any) {
  return {
    id: dk.id,
    tanggal: dk.tanggal,
    wbp_id: dk.wbpId || '',
    nama: dk.nama,
    nik: dk.nik || '',
    kamar: dk.kamar || '',
    keluhan1: dk.keluhan1 || '',
    keluhan2: dk.keluhan2 || '',
    keluhan3: dk.keluhan3 || '',
    penyakit1: dk.penyakit1 || '',
    jenis1: dk.jenis1 || undefined,
    penyakit2: dk.penyakit2 || '',
    jenis2: dk.jenis2 || undefined,
    penyakit3: dk.penyakit3 || '',
    jenis3: dk.jenis3 || undefined,
    terapi: dk.terapi || '',
    dokter_pemeriksa: dk.dokterPemeriksa || '',
    perawat: dk.perawat || '',
    catatan: dk.catatan || '',
    dihapus: Boolean(dk.dihapus),
    dibuat_pada: dk.dibuatPada || (dk.createdAt ? new Date(dk.createdAt).toISOString() : new Date().toISOString()),
    diubah_pada: dk.diubahPada || undefined,
  };
}

function mapReferensiFromClient(r: any): ReferensiInsert {
  return {
    id: String(r.id),
    keluhan: String(r.keluhan || ''),
    masukPenyakit: r.masuk_penyakit ?? r.masukPenyakit ?? '',
    kodeIcd10: r.kode_icd10 ?? r.kodeIcd10 ?? '',
    namaIcd10: r.nama_icd10 ?? r.namaIcd10 ?? '',
    jenis: r.jenis ?? 'Tidak Menular',
    catatan: r.catatan ?? '',
  };
}

function mapReferensiToClient(r: any) {
  return {
    id: r.id,
    keluhan: r.keluhan,
    masuk_penyakit: r.masukPenyakit || '',
    kode_icd10: r.kodeIcd10 || '',
    nama_icd10: r.namaIcd10 || '',
    jenis: r.jenis || 'Tidak Menular',
    catatan: r.catatan || '',
  };
}

function mapPenyakitFromClient(p: any, idx: number): PenyakitInsert {
  return {
    id: String(p.id),
    kategori: String(p.kategori || ''),
    penyakit: String(p.penyakit || ''),
    jenis: String(p.jenis || 'Tidak Menular'),
    urutan: p.urutan !== undefined ? Number(p.urutan) : idx + 1,
  };
}

function mapPenyakitToClient(p: any) {
  return {
    id: p.id,
    kategori: p.kategori,
    penyakit: p.penyakit,
    jenis: p.jenis,
    urutan: p.urutan,
  };
}

function mapSidbFromClient(h: any): SidbHistoryInsert {
  return {
    id: String(h.id),
    tanggal: String(h.tanggal || new Date().toISOString()),
    namaFile: String(h.nama_file ?? h.namaFile ?? ''),
    totalBaris: Number(h.total_baris ?? h.totalBaris ?? 0),
    wbpBaru: Number(h.wbp_baru ?? h.wbpBaru ?? 0),
    wbpDiperbarui: Number(h.wbp_diperbarui ?? h.wbpDiperbarui ?? 0),
    wbpDitandaiCek: Number(h.wbp_ditandai_cek ?? h.wbpDitandaiCek ?? 0),
  };
}

function mapSidbToClient(h: any) {
  return {
    id: h.id,
    tanggal: h.tanggal,
    nama_file: h.namaFile,
    total_baris: h.totalBaris ?? 0,
    wbp_baru: h.wbpBaru ?? 0,
    wbp_diperbarui: h.wbpDiperbarui ?? 0,
    wbp_ditandai_cek: h.wbpDitandaiCek ?? 0,
  };
}

function mapAuditToClient(a: any) {
  return {
    id: a.id,
    waktu: a.waktu,
    aksi: a.aksi,
    rincian: a.rincian,
    perangkat: a.perangkat || '',
  };
}

function mapMasterObatFromClient(o: any): MasterObatInsert {
  return {
    id: String(o.id),
    nama: String(o.nama || ''),
    kekuatan: String(o.kekuatan || ''),
    satuanTerkecil: String(o.satuan_terkecil ?? o.satuanTerkecil ?? 'tablet'),
    isiPerKotak: Math.max(1, Math.round(Number(o.isi_per_kotak ?? o.isiPerKotak ?? 1))),
    aktif: o.aktif ?? true,
  };
}

function mapMasterObatToClient(o: any) {
  return {
    id: o.id,
    nama: o.nama,
    kekuatan: o.kekuatan,
    satuan_terkecil: o.satuanTerkecil || 'tablet',
    isi_per_kotak: o.isiPerKotak ?? 1,
    aktif: o.aktif ?? true,
    dibuat_pada: o.createdAt ? new Date(o.createdAt).toISOString() : undefined,
  };
}

function mapResepObatFromClient(r: any, kunjunganIdOverride?: string): ResepObatInsert {
  return {
    id: String(r.id),
    kunjunganId: String(kunjunganIdOverride ?? r.kunjungan_id ?? r.kunjunganId ?? ''),
    obatId: String(r.obat_id ?? r.obatId ?? ''),
    jumlahPerMinum:
      r.jumlah_per_minum !== undefined && r.jumlah_per_minum !== null && r.jumlah_per_minum !== ''
        ? String(r.jumlah_per_minum)
        : null,
    frekuensiPerHari:
      r.frekuensi_per_hari !== undefined && r.frekuensi_per_hari !== null && r.frekuensi_per_hari !== ''
        ? Number(r.frekuensi_per_hari)
        : null,
    lamaHari:
      r.lama_hari !== undefined && r.lama_hari !== null && r.lama_hari !== ''
        ? Number(r.lama_hari)
        : null,
    jumlahDiberikan: Math.max(1, Math.round(Number(r.jumlah_diberikan ?? r.jumlahDiberikan ?? 1))),
    aturanPakai: r.aturan_pakai ?? r.aturanPakai ?? null,
    catatan: r.catatan ?? null,
  };
}

function mapResepObatToClient(r: any) {
  const numMinum = r.jumlahPerMinum !== null && r.jumlahPerMinum !== undefined && r.jumlahPerMinum !== ''
    ? Number(r.jumlahPerMinum)
    : undefined;
  return {
    id: r.id,
    kunjungan_id: r.kunjunganId,
    obat_id: r.obatId,
    jumlah_per_minum: numMinum !== undefined && !isNaN(numMinum) ? numMinum : undefined,
    frekuensi_per_hari: r.frekuensiPerHari ?? undefined,
    lama_hari: r.lamaHari ?? undefined,
    jumlah_diberikan: r.jumlahDiberikan,
    aturan_pakai: r.aturanPakai || undefined,
    catatan: r.catatan || undefined,
  };
}

// ============================================================================
// INITIAL SEEDING (ONLY ONCE ON FRESH DB, WITH COLD-START RETRY)
// ============================================================================
let seedCompleted = false;
let seedInFlight: Promise<void> | null = null;

async function runSeedWithRetry() {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const [seededFlag, existingSettings] = await Promise.all([
        getSetting('seeded_v1'),
        getSetting('app_settings'),
      ]);

      if (seededFlag) {
        if (!existingSettings) {
          await setSetting('app_settings', INITIAL_PENGATURAN);
        }
        syncVersion = await getSharedSyncVersion();
        seedCompleted = true;
        return;
      }

      await Promise.all([
        seedPenyakitIfEmpty(INITIAL_PENYAKIT.map((p, idx) => mapPenyakitFromClient(p, idx))),
        seedReferensiIfEmpty(INITIAL_REFERENSI.map(mapReferensiFromClient)),
        seedMasterObatIfEmpty(INITIAL_MASTER_OBAT.map(mapMasterObatFromClient)),
      ]);
      await seedWbpIfEmpty(INITIAL_WBP.map(mapWbpFromClient));
      await seedKunjunganIfEmpty(INITIAL_KUNJUNGAN.map(mapKunjunganFromClient));
      if (!existingSettings) {
        await setSetting('app_settings', INITIAL_PENGATURAN);
      }
      await setSetting('seeded_v1', true);

      syncVersion = await getSharedSyncVersion();
      seedCompleted = true;
      return;
    } catch (err) {
      console.error(`Initial seeding attempt ${attempt}/${maxAttempts} failed:`, err);
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
      }
    }
  }
}

async function ensureSeeded() {
  if (seedCompleted) return;
  if (!seedInFlight) {
    seedInFlight = runSeedWithRetry().finally(() => {
      seedInFlight = null;
    });
  }
  await seedInFlight;
}

async function buildFullSnapshot() {
  await ensureSeeded();
  const [
    sharedVersion,
    wbpRows,
    kunjunganRows,
    referensiRows,
    penyakitRows,
    appSettings,
    sidbRows,
    auditRows,
    obatRows,
    resepRows,
  ] = await Promise.all([
    getSharedSyncVersion(),
    getAllWbp(),
    getAllKunjungan(),
    getAllReferensi(),
    getAllPenyakit(),
    getSetting('app_settings'),
    getSidbHistoryList(),
    getAuditLogs(500),
    getAllMasterObat(),
    getAllResepObat(),
  ]);

  syncVersion = sharedVersion;

  return {
    version: sharedVersion,
    wbp: wbpRows.map(mapWbpToClient),
    kunjungan: kunjunganRows.map(mapKunjunganToClient),
    referensi: referensiRows.map(mapReferensiToClient),
    penyakit: penyakitRows.map(mapPenyakitToClient),
    pengaturan: appSettings || INITIAL_PENGATURAN,
    sidb_history: sidbRows.map(mapSidbToClient),
    audit_logs: auditRows.map(mapAuditToClient),
    master_obat: obatRows.map(mapMasterObatToClient),
    resep_obat: resepRows.map(mapResepObatToClient),
  };
}

// ============================================================================
// AUTHENTICATION & USER MANAGEMENT (Fase 1)
// ============================================================================

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
  rememberMe: z.boolean().optional(),
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});
const createUserSchema = z.object({
  username: z.string().trim().min(3).max(64),
  email: z.string().email().max(200).optional(),
  displayName: z.string().trim().max(200).optional(),
  role: z.enum(['admin','dokter_perawat','petugas_administrasi']),
  password: z.string().min(8).max(200),
});

app.post('/api/auth/login', loginLimiter, async (req: any, res) => {
  try {
    await ensureBootstrapAdmin();
    const body = parseOr400(loginSchema, req, res);
    if (!body) return;
    const username = body.username.trim();
    const password = body.password;
    let user = await findUserByUsername(username);
    if (!user || !user.isActive) {
      await auditServer(req, 'Login Gagal', `Percobaan login gagal untuk username "${username}"`, username);
      return res.status(401).json({ error: 'Username atau kata sandi tidak sesuai.' });
    }
    const stored = (user as any).passwordHash || '';
    const vr = verifyScryptOrLegacy(password, stored);
    if (!vr.ok) {
      await auditServer({ ...req, authUser: { id: String((user as any).id||user.uid), username: user.username, role: user.role } } as any, 'Login Gagal', 'Kata sandi salah', username);
      return res.status(401).json({ error: 'Username atau kata sandi tidak sesuai.' });
    }
    // upgrade legacy hash
    if (vr.needsRehash) {
      try { await createOrUpdateUser({ ...(user as any), passwordHash: hashPasswordServer(password) }); } catch {}
    }
    const rememberMe = Boolean(body.rememberMe);
    const ttl = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const payload = {
      sub: (user as any).uid,
      uid: (user as any).uid,
      username: (user as any).username,
      role: (user as any).role,
      mustChangePassword: Boolean((user as any).mustChangePassword),
      exp: Date.now() + ttl,
    };
    const token = signSessionToken(payload);
    await auditServer({ ...req, authUser: { id: String((user as any).id||user.uid), username: user.username, role: user.role } } as any, 'Login Berhasil', 'Petugas masuk ke sistem', username);
    res.json({
      token,
      user: {
        uid: (user as any).uid,
        username: (user as any).username,
        displayName: (user as any).displayName || (user as any).username,
        role: (user as any).role,
        mustChangePassword: Boolean((user as any).mustChangePassword),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Gagal memproses login.' });
  }
});

app.get('/api/auth/me', ...authChain, async (req: any, res) => {
  const u = req.authUser;
  res.json({ user: u });
});

app.post('/api/auth/change-password', requireAuth, async (req: any, res) => {
  try {
    const body = parseOr400(changePasswordSchema, req, res);
    if (!body) return;
    const u = req.authUser;
    if (!u) return res.status(401).json({ error: 'Tidak terautentikasi.' });
    const dbUser = await findUserByUsername(u.username) || (u.uid ? await findUserByUid(u.uid) : null);
    if (!dbUser) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    const stored = (dbUser as any).passwordHash || '';
    const vr = verifyScryptOrLegacy(body.currentPassword, stored);
    if (!vr.ok) return res.status(400).json({ error: 'Kata sandi saat ini tidak sesuai.' });
    if (body.newPassword.length < 8) return res.status(400).json({ error: 'Kata sandi baru minimal 8 karakter.' });
    await createOrUpdateUser({ ...(dbUser as any), passwordHash: hashPasswordServer(body.newPassword), mustChangePassword: false });
    await auditServer(req, 'Ganti Kata Sandi', 'Pengguna mengganti kata sandi sendiri', u.username);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Gagal mengganti kata sandi.' });
  }
});

app.get('/api/auth/users', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin')], async (req: any, res) => {
  try {
    const usersList = await listUsers();
    res.json(usersList.map((u: any) => ({
      uid: u.uid, username: u.username, displayName: u.displayName, role: u.role, email: u.email, mustChangePassword: u.mustChangePassword, isActive: u.isActive,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/users', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin')], async (req: any, res) => {
  try {
    const body = parseOr400(createUserSchema, req, res);
    if (!body) return;
    const created = await createOrUpdateUser({
      username: body.username,
      email: body.email || `${body.username}@local.invalid`,
      displayName: body.displayName || body.username,
      role: body.role,
      passwordHash: hashPasswordServer(body.password),
      mustChangePassword: true,
      isActive: true,
    } as any);
    await auditServer(req, 'Buat Pengguna', `Admin membuat pengguna ${body.username} (${body.role})`, body.username);
    res.json({ success: true, user: { uid: (created as any).uid, username: body.username, role: body.role } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================================
// HEALTH, VERSION & FULL SNAPSHOT ENDPOINTS
// ============================================================================
app.get('/api/health', async (_req: any, res) => {
  const dbHealth = await checkDatabaseHealth();
  const version = await getSharedSyncVersion();
  res.status(dbHealth.mode === 'cloudsql' && !dbHealth.connected ? 503 : 200).json({
    ok: dbHealth.mode === 'memory' || dbHealth.connected,
    database: dbHealth.mode,
    connected: dbHealth.connected,
    version,
    timestamp: new Date().toISOString(),
    ...(dbHealth.error ? { error: dbHealth.error } : {}),
  });
});

app.get('/api/sync/version', ...authChain, async (_req: any, res) => {
  try {
    const version = await getSharedSyncVersion();
    syncVersion = version;
    res.json({ version });
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

app.get('/api/sync/state', ...authChain, async (req: any, res) => {
  try {
    const snapshot = await buildFullSnapshot();
    if (req.authUser?.role !== 'admin') {
      snapshot.audit_logs = [];
    }
    await auditServer(req, 'Baca Data', 'Membaca snapshot data sinkronisasi (termasuk rekam medis)', 'sync/state');
    res.json(snapshot);
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

app.get('/api/backup/export', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const snapshot = await buildFullSnapshot();
    await auditServer(req, 'Ekspor Data', 'Mengekspor cadangan data (termasuk rekam medis)', 'backup/export');
    res.json({
      version: '2.0',
      app_name: 'Klinik Pratama Lapas Kelas IIB Dompu',
      exported_at: new Date().toISOString(),
      counts: {
        wbp: snapshot.wbp.length,
        kunjungan_total: snapshot.kunjungan.length,
        kunjungan_aktif: snapshot.kunjungan.filter((k: any) => !k.dihapus).length,
        kunjungan_sampah: snapshot.kunjungan.filter((k: any) => k.dihapus).length,
        referensi: snapshot.referensi.length,
        penyakit: snapshot.penyakit.length,
        master_obat: snapshot.master_obat.length,
        resep_obat: snapshot.resep_obat.length,
        sidb_history: snapshot.sidb_history.length,
        audit_logs: snapshot.audit_logs.length,
      },
      wbp: snapshot.wbp,
      kunjungan: snapshot.kunjungan,
      referensi: snapshot.referensi,
      penyakit: snapshot.penyakit,
      pengaturan: snapshot.pengaturan,
      sidb_history: snapshot.sidb_history,
      audit_logs: snapshot.audit_logs,
      master_obat: snapshot.master_obat,
      resep_obat: snapshot.resep_obat,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/backup/restore', jsonLarge, ...adminDestructive, requireConfirm('PULIHKAN CADANGAN'), async (req: any, res) => {
  try {
    const raw = req.body || {};
    const data = raw.backup && typeof raw.backup === 'object' ? raw.backup : raw;
    const clientId = req.headers['x-client-id'] as string | undefined;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Format cadangan tidak valid' });
    }
    await auditServer(req, 'Pulihkan Cadangan', 'Memulihkan data dari cadangan (overwrite)', 'backup/restore');

    const wbpRows: WbpInsert[] = Array.isArray(data.wbp) ? data.wbp.map(mapWbpFromClient) : [];
    const wbpIdSet = new Set(wbpRows.map((w) => w.id));
    const kunjunganRows: KunjunganInsert[] = Array.isArray(data.kunjungan)
      ? data.kunjungan.map((k: any) => {
          const mapped = mapKunjunganFromClient(k);
          if (mapped.wbpId && !wbpIdSet.has(mapped.wbpId)) {
            mapped.wbpId = null;
          }
          return mapped;
        })
      : [];
    const kunjunganIdSet = new Set(kunjunganRows.map((k) => k.id));
    const referensiRows: ReferensiInsert[] = Array.isArray(data.referensi)
      ? data.referensi.map(mapReferensiFromClient)
      : INITIAL_REFERENSI.map(mapReferensiFromClient);
    const penyakitRows: PenyakitInsert[] = Array.isArray(data.penyakit)
      ? data.penyakit.map((p: any, idx: number) => mapPenyakitFromClient(p, idx))
      : INITIAL_PENYAKIT.map((p, idx) => mapPenyakitFromClient(p, idx));
    const sidbRows: SidbHistoryInsert[] = Array.isArray(data.sidb_history)
      ? data.sidb_history.map(mapSidbFromClient)
      : [];
    const auditRows: AuditLogInsert[] = Array.isArray(data.audit_logs)
      ? data.audit_logs.map((a: any) => ({
          id: String(a.id),
          waktu: String(a.waktu || new Date().toISOString()),
          aksi: String(a.aksi || 'Log'),
          rincian: String(a.rincian || ''),
          perangkat: a.perangkat ?? '',
        }))
      : [];
    const masterObatRows: MasterObatInsert[] | undefined = Array.isArray(data.master_obat)
      ? data.master_obat.map(mapMasterObatFromClient)
      : undefined;
    const validObatIdSet = new Set(
      (masterObatRows ?? (await getAllMasterObat())).map((o) => o.id)
    );
    const resepObatRows: ResepObatInsert[] | undefined = Array.isArray(data.resep_obat)
      ? data.resep_obat
          .map((r: any) => mapResepObatFromClient(r))
          .filter((r: ResepObatInsert) => kunjunganIdSet.has(r.kunjunganId) && validObatIdSet.has(r.obatId))
      : undefined;

    await restoreAllTables({
      wbp: wbpRows,
      kunjungan: kunjunganRows,
      referensi: referensiRows,
      penyakit: penyakitRows,
      pengaturan: data.pengaturan ? { ...INITIAL_PENGATURAN, ...data.pengaturan } : INITIAL_PENGATURAN,
      sidbHistory: sidbRows,
      auditLogs: auditRows,
      masterObat: masterObatRows,
      resepObat: resepObatRows,
    });

    await broadcastSync('full_restore', clientId);
    res.json({ success: true, version: syncVersion });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/system/factory-reset', ...adminDestructive, blockInProduction('Factory reset'), requireConfirm('RESET PABRIK'), async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    await auditServer(req, 'Reset Pabrik', 'Melakukan reset sistem ke data awal (factory reset)', 'system/factory-reset');
    await restoreAllTables({
      wbp: INITIAL_WBP.map(mapWbpFromClient),
      kunjungan: INITIAL_KUNJUNGAN.map(mapKunjunganFromClient),
      referensi: INITIAL_REFERENSI.map(mapReferensiFromClient),
      penyakit: INITIAL_PENYAKIT.map((p, idx) => mapPenyakitFromClient(p, idx)),
      pengaturan: INITIAL_PENGATURAN,
      sidbHistory: [],
      auditLogs: [],
      masterObat: INITIAL_MASTER_OBAT.map(mapMasterObatFromClient),
      resepObat: [],
    });
    await broadcastSync('factory_reset', clientId);
    res.json({ success: true, version: syncVersion });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// WBP ENDPOINTS
// ============================================================================
app.get('/api/wbp', ...authChain, async (req: any, res) => {
  try {
    const list = await getAllWbp();
    await auditServer(req, 'Baca Data', 'Membaca daftar data WBP', 'wbp');
    res.json(list.map(mapWbpToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/wbp', ...writeAdminOrMed, async (req: any, res) => {
  try {
    const body = parseOr400(wbpBodySchema, req, res); if (!body) return;
    const clientId = req.headers['x-client-id'] as string | undefined;
    const saved = await upsertWbpSingle(mapWbpFromClient(body));
    await broadcastSync('wbp', clientId);
    res.json(mapWbpToClient(saved, 0));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/wbp/:id', ...writeAdminOrMed, async (req: any, res) => {
  try {
    const body = parseOr400(wbpBodySchema, req, res); if (!body) return;
    const clientId = req.headers['x-client-id'] as string | undefined;
    const saved = await upsertWbpSingle(mapWbpFromClient({ ...body, id: req.params.id }));
    await broadcastSync('wbp', clientId);
    res.json(mapWbpToClient(saved, 0));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/wbp/all', ...adminDestructive, requireConfirm('HAPUS SEMUA WBP'), async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const result = await clearAllWbpFromDb();
    await auditServer(req, 'Hapus Semua WBP', `Menghapus seluruh data WBP (${result.length} data)`, 'wbp/all', { count: result.length });
    await broadcastSync('wbp', clientId);
    res.json({ message: 'All WBP deleted', count: result.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/wbp/:id', ...writeAdminOrMed, async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const result = await deleteWbpById(req.params.id);
    await broadcastSync('wbp', clientId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/wbp/batch', ...writeAdminOrMed, async (req: any, res) => {
  try {
    const body = parseOr400(genericArraySchema, req, res); if (!body) return;
    const clientId = req.headers['x-client-id'] as string | undefined;
    const items = Array.isArray(body) ? body.map(mapWbpFromClient) : [];
    const result = await upsertWbpBatch(items);
    await broadcastSync('wbp', clientId);
    res.json(result.map(mapWbpToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// KUNJUNGAN ENDPOINTS
// ============================================================================
app.get('/api/kunjungan', ...authChain, async (req: any, res) => {
  try {
    const list = await getAllKunjungan();
    await auditServer(req, 'Baca Data', 'Membaca daftar rekam medis/kunjungan', 'kunjungan');
    res.json(list.map(mapKunjunganToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/kunjungan', ...writeMedical, async (req: any, res) => {
  try {
    const body = parseOr400(kunjunganBodySchema, req, res); if (!body) return;
    const clientId = req.headers['x-client-id'] as string | undefined;
    const payload = mapKunjunganFromClient(body);
    if (payload.wbpId === '') payload.wbpId = null;
    const result = await insertKunjungan(payload);
    await broadcastSync('kunjungan', clientId);
    res.json(mapKunjunganToClient(result));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/kunjungan/:id', ...writeMedical, async (req: any, res) => {
  try {
    const body = parseOr400(kunjunganBodySchema, req, res); if (!body) return;
    const clientId = req.headers['x-client-id'] as string | undefined;
    const payload = mapKunjunganFromClient({ ...body, id: req.params.id });
    if (payload.wbpId === '') payload.wbpId = null;
    const result = await updateKunjunganById(req.params.id, {
      ...payload,
      diubahPada: new Date().toISOString(),
    });
    await broadcastSync('kunjungan', clientId);
    res.json(result ? mapKunjunganToClient(result) : null);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/kunjungan/batch', ...writeMedical, async (req: any, res) => {
  try {
    const body = parseOr400(genericArraySchema, req, res); if (!body) return;
    const clientId = req.headers['x-client-id'] as string | undefined;
    const items = Array.isArray(body)
      ? body.map((k: any) => {
          const mapped = mapKunjunganFromClient(k);
          if (mapped.wbpId === '') mapped.wbpId = null;
          return mapped;
        })
      : [];
    const result = await insertKunjunganBatch(items);
    await broadcastSync('kunjungan', clientId);
    res.json(result.map(mapKunjunganToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/kunjungan/all', ...adminDestructive, requireConfirm('HAPUS SEMUA KUNJUNGAN'), async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const result = await clearAllKunjunganFromDb();
    await auditServer(req, 'Hapus Semua Kunjungan', `Menghapus seluruh data kunjungan (${result.length} data)`, 'kunjungan/all', { count: result.length });
    await broadcastSync('kunjungan', clientId);
    res.json({ message: 'All visits deleted', count: result.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/kunjungan/:id/restore', ...writeMedical, async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const result = await restoreKunjunganById(req.params.id);
    await broadcastSync('kunjungan', clientId);
    res.json(result.map(mapKunjunganToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/kunjungan/:id/permanent', ...adminDestructive, async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    await deleteResepByKunjunganId(req.params.id);
    const result = await permanentDeleteKunjunganById(req.params.id);
    await broadcastSync('kunjungan', clientId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/kunjungan/:id', ...writeMedical, async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    await deleteResepByKunjunganId(req.params.id);
    const result = await softDeleteKunjungan(req.params.id);
    await broadcastSync('kunjungan', clientId);
    res.json(result.map(mapKunjunganToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PENYAKIT & REFERENSI ICD-10 ENDPOINTS
// ============================================================================
app.get('/api/penyakit', ...authChain, async (_req: any, res) => {
  try {
    const list = await getAllPenyakit();
    res.json(list.map(mapPenyakitToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/penyakit', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const saved = await upsertPenyakit(mapPenyakitFromClient(req.body, 0));
    await broadcastSync('penyakit', clientId);
    res.json(mapPenyakitToClient(saved));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/penyakit/:id', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const saved = await upsertPenyakit(mapPenyakitFromClient({ ...req.body, id: req.params.id }, 0));
    if (req.body.jenis && req.body.penyakit) {
      await updateReferensiJenisByPenyakit(req.body.penyakit, req.body.jenis);
    }
    await broadcastSync('penyakit', clientId);
    res.json(mapPenyakitToClient(saved));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/penyakit/batch', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const bodyItems = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.items) ? req.body.items : [];
    const replaceAll = Boolean(!Array.isArray(req.body) && req.body?.replaceAll);
    const mapped = bodyItems.map((p: any, idx: number) => mapPenyakitFromClient(p, idx));
    const saved = await replacePenyakitBatch(mapped, replaceAll);
    await broadcastSync('penyakit', clientId);
    res.json(saved.map(mapPenyakitToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/referensi', ...authChain, async (_req: any, res) => {
  try {
    const list = await getAllReferensi();
    res.json(list.map(mapReferensiToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/referensi/batch', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const bodyItems = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.items) ? req.body.items : [];
    const replaceAll = Boolean(!Array.isArray(req.body) && req.body?.replaceAll);
    const mapped = bodyItems.map(mapReferensiFromClient);
    const saved = await replaceReferensiBatch(mapped, replaceAll);
    await broadcastSync('referensi', clientId);
    res.json(saved.map(mapReferensiToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/referensi', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const saved = await upsertReferensi(mapReferensiFromClient(req.body));
    await broadcastSync('referensi', clientId);
    res.json(mapReferensiToClient(saved));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/referensi/:id', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const saved = await upsertReferensi(mapReferensiFromClient({ ...req.body, id: req.params.id }));
    await broadcastSync('referensi', clientId);
    res.json(mapReferensiToClient(saved));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/referensi/:id', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const result = await deleteReferensiById(req.params.id);
    await broadcastSync('referensi', clientId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PENGATURAN, SIDB HISTORY & AUDIT LOG ENDPOINTS
// ============================================================================
app.get('/api/pengaturan/:key', ...authChain, async (req: any, res) => {
  try {
    const value = await getSetting(req.params.key);
    res.json(value);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pengaturan/:key', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    let value = req.body;
    if (req.params.key === 'app_settings' && value && typeof value === 'object') {
      value = { ...value, password_hash: '' };
    }
    const result = await setSetting(req.params.key, value);
    await broadcastSync('pengaturan', clientId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sidb-history', ...authChain, async (_req: any, res) => {
  try {
    const list = await getSidbHistoryList();
    res.json(list.map(mapSidbToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sidb-history', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const saved = await addSidbHistoryEntry(mapSidbFromClient(req.body));
    await broadcastSync('sidb_history', clientId);
    res.json(saved ? mapSidbToClient(saved) : null);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/audit', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin')], async (req: any, res) => {
  try {
    const list = await getAuditLogs(500);
    res.json(list.map(mapAuditToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/audit', ...authChain, async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const body = req.body || {};
    const entry = {
      id: String(body.id || ('log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))),
      waktu: String(body.waktu || new Date().toISOString()),
      aksi: String(body.aksi || 'Log'),
      rincian: String(body.rincian || ''),
      perangkat: String(body.perangkat || req.headers['user-agent'] || ''),
      userId: req.authUser ? String(req.authUser.id) : null,
      username: req.authUser?.username || null,
      role: req.authUser?.role || null,
      ipAddress: req.clientIp || null,
      target: body.target || null,
      metadata: body.metadata || null,
    };
    const result = await addAuditLog(entry as any);
    await broadcastSync('audit', clientId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// MASTER OBAT & RESEP OBAT ENDPOINTS
// ============================================================================
app.get('/api/obat', ...authChain, async (_req: any, res) => {
  try {
    const list = await getAllMasterObat();
    res.json(list.map(mapMasterObatToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/obat/batch', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const bodyItems = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.items) ? req.body.items : [];
    const replaceAll = Boolean(!Array.isArray(req.body) && req.body?.replaceAll);
    const mapped = bodyItems.map(mapMasterObatFromClient);
    const saved = await replaceMasterObatBatch(mapped, replaceAll);
    await broadcastSync('obat', clientId);
    res.json(saved.map(mapMasterObatToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/obat', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const saved = await upsertMasterObat(mapMasterObatFromClient(req.body));
    await broadcastSync('obat', clientId);
    res.json(mapMasterObatToClient(saved));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/obat/:id', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const result = await deleteMasterObatById(req.params.id);
    await broadcastSync('obat', clientId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/resep', ...authChain, async (_req: any, res) => {
  try {
    const list = await getAllResepObat();
    res.json(list.map(mapResepObatToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/resep/kunjungan/:kunjunganId', ...[requireAuth, rejectIfMustChangePassword, requireRoles('admin','dokter_perawat')], async (req: any, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string | undefined;
    const items = Array.isArray(req.body)
      ? req.body.map((r: any) => mapResepObatFromClient(r, req.params.kunjunganId))
      : [];
    const saved = await replaceResepForKunjungan(req.params.kunjunganId, items);
    await broadcastSync('resep', clientId);
    res.json(saved.map(mapResepObatToClient));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Ensure unknown API routes always return JSON 404 instead of SPA index.html
app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

function enforceProductionDatabaseOrExit() {
  if (isProd && !db) {
    // eslint-disable-next-line no-console
    console.error('[FATAL] Database tidak terkonfigurasi/terhubung. Server produksi menolak start tanpa database.');
    process.exit(1);
  }
}

// Setup Vite middlewares for Frontend SPA
async function startServer() {
  enforceProductionDatabaseOrExit();
  const isProdEnv = process.env.NODE_ENV === 'production';

  if (!isProdEnv) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Server Klinik Lapas Dompu running on http://0.0.0.0:${port}`);
    void ensureSeeded();
  });

  const shutdown = () => {
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    sseClients.clear();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
