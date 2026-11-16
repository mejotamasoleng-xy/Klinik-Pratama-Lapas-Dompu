import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Mandatory users table per cloudsql-setup skill
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID or local id
  email: text('email').notNull(),
  username: text('username'),
  displayName: text('display_name'),
  role: text('role').notNull().default('petugas_administrasi'), // admin | dokter_perawat | petugas_administrasi
  passwordHash: text('password_hash'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  usernameIdx: index('users_username_idx').on(t.username),
}));

export const rateLimitState = pgTable('rate_limit_state', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  windowStart: bigint('window_start', { mode: 'number' }).notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const wbp = pgTable('wbp', {
  id: text('id').primaryKey(),
  no: integer('no'),
  nik: text('nik'),
  noRegInstansi: text('no_reg_instansi'),
  nama: text('nama').notNull(),
  jenisKelamin: text('jenis_kelamin').default('Laki-laki'),
  tempatLahir: text('tempat_lahir'),
  tanggalLahir: date('tanggal_lahir', { mode: 'string' }),
  alamat: text('alamat'),
  namaAyah: text('nama_ayah'),
  namaIbu: text('nama_ibu'),
  pekerjaan: text('pekerjaan'),
  jenisKejahatan: text('jenis_kejahatan'),
  kategori: text('kategori').default('Narapidana'),
  lamaPidana: text('lama_pidana'),
  tanggalMasuk: date('tanggal_masuk', { mode: 'string' }),
  tglEkspirasi: date('tgl_ekspirasi', { mode: 'string' }),
  blok: text('blok').default(''),
  kamar: text('kamar').default(''),
  kamarSidb: text('kamar_sidb').default(''),
  lokasiSel: text('lokasi_sel'),
  tglSuratPenahanan: date('tgl_surat_penahanan', { mode: 'string' }),
  nomorSuratPenahanan: text('nomor_surat_penahanan'),
  statusData: text('status_data').default('Aktif'),
  batchBpjs: text('batch_bpjs').default('Belum masuk batch'),
  statusSkrining: text('status_skrining'),
  kendalaBpjs: text('kendala_bpjs'),
  dasarPbi: text('dasar_pbi'),
  catatanPenggabungan: text('catatan_penggabungan'),
  perluDicek: boolean('perlu_dicek').default(false),
  sumberUpdate: text('sumber_update'),
  terakhirDiperbarui: text('terakhir_diperbarui'),
  dibuatPada: text('dibuat_pada'),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  nikIdx: index('wbp_nik_idx').on(t.nik),
  nikUnique: uniqueIndex('wbp_nik_unique').on(t.nik).where(sql`${t.nik} is not null and ${t.nik} <> ''`),
  noRegUnique: uniqueIndex('wbp_no_reg_unique').on(t.noRegInstansi).where(sql`${t.noRegInstansi} is not null and ${t.noRegInstansi} <> ''`),
}));

export const kunjungan = pgTable('kunjungan', {
  id: text('id').primaryKey(),
  tanggal: date('tanggal', { mode: 'string' }).notNull(),
  wbpId: text('wbp_id').references(() => wbp.id, { onDelete: 'set null' }),
  nama: text('nama').notNull(),
  nik: text('nik'),
  kamar: text('kamar').default(''),
  keluhan1: text('keluhan1'),
  keluhan2: text('keluhan2'),
  keluhan3: text('keluhan3'),
  penyakit1: text('penyakit1'),
  jenis1: text('jenis1'),
  penyakit2: text('penyakit2'),
  jenis2: text('jenis2'),
  penyakit3: text('penyakit3'),
  jenis3: text('jenis3'),
  terapi: text('terapi'),
  dokterPemeriksa: text('dokter_pemeriksa'),
  perawat: text('perawat'),
  catatan: text('catatan'),
  dihapus: boolean('dihapus').default(false),
  dibuatPada: text('dibuat_pada'),
  diubahPada: text('diubah_pada'),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  tanggalIdx: index('kunjungan_tanggal_idx').on(t.tanggal),
  wbpIdIdx: index('kunjungan_wbp_id_idx').on(t.wbpId),
}));

export const daftarPenyakit = pgTable('daftar_penyakit', {
  id: text('id').primaryKey(),
  kategori: text('kategori').notNull(),
  penyakit: text('penyakit').notNull(),
  jenis: text('jenis').notNull(),
  urutan: integer('urutan').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const referensiIcd10 = pgTable('referensi_icd10', {
  id: text('id').primaryKey(),
  keluhan: text('keluhan').notNull(),
  masukPenyakit: text('masuk_penyakit'),
  kodeIcd10: text('kode_icd10'),
  namaIcd10: text('nama_icd10'),
  jenis: text('jenis').default('Tidak Menular'),
  catatan: text('catatan'),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  keluhanIdx: index('referensi_keluhan_idx').on(t.keluhan),
}));

export const pengaturanApp = pgTable('pengaturan_app', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  waktu: text('waktu').notNull(),
  aksi: text('aksi').notNull(),
  rincian: text('rincian').notNull(),
  perangkat: text('perangkat'),
  userId: text('user_id'),
  username: text('username'),
  role: text('role'),
  ipAddress: text('ip_address'),
  target: text('target'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const sidbHistory = pgTable('sidb_history', {
  id: text('id').primaryKey(),
  tanggal: text('tanggal').notNull(),
  namaFile: text('nama_file').notNull(),
  totalBaris: integer('total_baris').default(0),
  wbpBaru: integer('wbp_baru').default(0),
  wbpDiperbarui: integer('wbp_diperbarui').default(0),
  wbpDitandaiCek: integer('wbp_ditandai_cek').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const masterObat = pgTable('master_obat', {
  id: text('id').primaryKey(),
  nama: text('nama').notNull(),
  kekuatan: text('kekuatan').notNull(),
  satuanTerkecil: text('satuan_terkecil').notNull(),
  isiPerKotak: integer('isi_per_kotak').notNull().default(1),
  aktif: boolean('aktif').default(true),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const resepObat = pgTable('resep_obat', {
  id: text('id').primaryKey(),
  kunjunganId: text('kunjungan_id').notNull().references(() => kunjungan.id, { onDelete: 'cascade' }),
  obatId: text('obat_id').notNull().references(() => masterObat.id, { onDelete: 'restrict' }),
  jumlahPerMinum: text('jumlah_per_minum'),
  frekuensiPerHari: integer('frekuensi_per_hari'),
  lamaHari: integer('lama_hari'),
  jumlahDiberikan: integer('jumlah_diberikan').notNull(),
  aturanPakai: text('aturan_pakai'),
  catatan: text('catatan'),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => ({
  kunjunganIdx: index('resep_kunjungan_idx').on(t.kunjunganId),
  obatIdx: index('resep_obat_idx').on(t.obatId),
}));

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  scope: text('scope'),
  response: jsonb('response'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

