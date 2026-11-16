import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
});

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
  tanggalLahir: text('tanggal_lahir'),
  alamat: text('alamat'),
  namaAyah: text('nama_ayah'),
  namaIbu: text('nama_ibu'),
  pekerjaan: text('pekerjaan'),
  jenisKejahatan: text('jenis_kejahatan'),
  kategori: text('kategori').default('Narapidana'),
  lamaPidana: text('lama_pidana'),
  tanggalMasuk: text('tanggal_masuk'),
  tglEkspirasi: text('tgl_ekspirasi'),
  blok: text('blok').default(''),
  kamar: text('kamar').default(''),
  kamarSidb: text('kamar_sidb').default(''),
  lokasiSel: text('lokasi_sel'),
  tglSuratPenahanan: text('tgl_surat_penahanan'),
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
  createdAt: timestamp('created_at').defaultNow(),
});

export const kunjungan = pgTable('kunjungan', {
  id: text('id').primaryKey(),
  tanggal: text('tanggal').notNull(),
  wbpId: text('wbp_id'),
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
  createdAt: timestamp('created_at').defaultNow(),
});

export const daftarPenyakit = pgTable('daftar_penyakit', {
  id: text('id').primaryKey(),
  kategori: text('kategori').notNull(),
  penyakit: text('penyakit').notNull(),
  jenis: text('jenis').notNull(),
  urutan: integer('urutan').notNull().default(0),
});

export const referensiIcd10 = pgTable('referensi_icd10', {
  id: text('id').primaryKey(),
  keluhan: text('keluhan').notNull(),
  masukPenyakit: text('masuk_penyakit'),
  kodeIcd10: text('kode_icd10'),
  namaIcd10: text('nama_icd10'),
  jenis: text('jenis').default('Tidak Menular'),
  catatan: text('catatan'),
});

export const pengaturanApp = pgTable('pengaturan_app', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
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
  createdAt: timestamp('created_at').defaultNow(),
});

export const resepObat = pgTable('resep_obat', {
  id: text('id').primaryKey(),
  kunjunganId: text('kunjungan_id').notNull(),
  obatId: text('obat_id').notNull(),
  jumlahPerMinum: text('jumlah_per_minum'),
  frekuensiPerHari: integer('frekuensi_per_hari'),
  lamaHari: integer('lama_hari'),
  jumlahDiberikan: integer('jumlah_diberikan').notNull(),
  aturanPakai: text('aturan_pakai'),
  catatan: text('catatan'),
  createdAt: timestamp('created_at').defaultNow(),
});
