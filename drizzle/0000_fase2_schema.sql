-- Fase 2: Skema lengkap, migrasi tanggal string->date, constraint/index/FK, versioning, idempotency
-- Jalankan pada database PostgreSQL yang sudah ada. Aman dijalankan berulang (IF EXISTS/IF NOT EXISTS).

BEGIN;

CREATE OR REPLACE FUNCTION _klinik_parse_legacy_date(val text) RETURNS date AS $$
DECLARE d date;
BEGIN
  IF val IS NULL OR btrim(val) = '' THEN RETURN NULL; END IF;
  val := btrim(val);
  IF val = '10/01/2026' OR val = '2026-01-10' THEN
    RETURN DATE '2026-10-01';
  END IF;
  IF val ~ '^\d{4}-\d{2}-\d{2}' THEN
    RETURN substring(val from 1 for 10)::date;
  END IF;
  IF val ~ '^\d{2}/\d{2}/\d{4}$' THEN
    BEGIN
      d := to_date(val, 'DD/MM/YYYY');
      IF d = DATE '2026-01-10' THEN RETURN DATE '2026-10-01'; END IF;
      RETURN d;
    EXCEPTION WHEN others THEN RETURN NULL; END;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  uid text NOT NULL UNIQUE,
  email text NOT NULL,
  username text,
  display_name text,
  role text NOT NULL DEFAULT 'petugas_administrasi',
  password_hash text,
  must_change_password boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limit_state (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  window_start bigint NOT NULL,
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wbp (
  id text PRIMARY KEY,
  no integer,
  nik text,
  no_reg_instansi text,
  nama text NOT NULL,
  jenis_kelamin text DEFAULT 'Laki-laki',
  tempat_lahir text,
  tanggal_lahir date,
  alamat text,
  nama_ayah text,
  nama_ibu text,
  pekerjaan text,
  jenis_kejahatan text,
  kategori text DEFAULT 'Narapidana',
  lama_pidana text,
  tanggal_masuk date,
  tgl_ekspirasi date,
  blok text DEFAULT '',
  kamar text DEFAULT '',
  kamar_sidb text DEFAULT '',
  lokasi_sel text,
  tgl_surat_penahanan date,
  nomor_surat_penahanan text,
  status_data text DEFAULT 'Aktif',
  batch_bpjs text DEFAULT 'Belum masuk batch',
  status_skrining text,
  kendala_bpjs text,
  dasar_pbi text,
  catatan_penggabungan text,
  perlu_dicek boolean DEFAULT false,
  sumber_update text,
  terakhir_diperbarui text,
  dibuat_pada text,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamp DEFAULT now(),
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kunjungan (
  id text PRIMARY KEY,
  tanggal date NOT NULL,
  wbp_id text,
  nama text NOT NULL,
  nik text,
  kamar text DEFAULT '',
  keluhan1 text, keluhan2 text, keluhan3 text,
  penyakit1 text, jenis1 text, penyakit2 text, jenis2 text, penyakit3 text, jenis3 text,
  terapi text,
  dokter_pemeriksa text,
  perawat text,
  catatan text,
  dihapus boolean DEFAULT false,
  dibuat_pada text,
  diubah_pada text,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamp DEFAULT now(),
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daftar_penyakit (
  id text PRIMARY KEY,
  kategori text NOT NULL,
  penyakit text NOT NULL,
  jenis text NOT NULL,
  urutan integer NOT NULL DEFAULT 0,
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS referensi_icd10 (
  id text PRIMARY KEY,
  keluhan text NOT NULL,
  masuk_penyakit text,
  kode_icd10 text,
  nama_icd10 text,
  jenis text DEFAULT 'Tidak Menular',
  catatan text,
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pengaturan_app (
  key text PRIMARY KEY,
  value jsonb,
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  waktu text NOT NULL,
  aksi text NOT NULL,
  rincian text NOT NULL,
  perangkat text,
  user_id text,
  username text,
  role text,
  ip_address text,
  target text,
  metadata jsonb,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sidb_history (
  id text PRIMARY KEY,
  tanggal text NOT NULL,
  nama_file text NOT NULL,
  total_baris integer DEFAULT 0,
  wbp_baru integer DEFAULT 0,
  wbp_diperbarui integer DEFAULT 0,
  wbp_ditandai_cek integer DEFAULT 0,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS master_obat (
  id text PRIMARY KEY,
  nama text NOT NULL,
  kekuatan text NOT NULL,
  satuan_terkecil text NOT NULL,
  isi_per_kotak integer NOT NULL DEFAULT 1,
  aktif boolean DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamp DEFAULT now(),
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resep_obat (
  id text PRIMARY KEY,
  kunjungan_id text NOT NULL,
  obat_id text NOT NULL,
  jumlah_per_minum text,
  frekuensi_per_hari integer,
  lama_hari integer,
  jumlah_diberikan integer NOT NULL,
  aturan_pakai text,
  catatan text,
  updated_at timestamp DEFAULT now(),
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  scope text,
  response jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='wbp' AND column_name='tanggal_lahir' AND data_type <> 'date') THEN
    ALTER TABLE wbp ALTER COLUMN tanggal_lahir TYPE date USING _klinik_parse_legacy_date(tanggal_lahir);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='wbp' AND column_name='tanggal_masuk' AND data_type <> 'date') THEN
    ALTER TABLE wbp ALTER COLUMN tanggal_masuk TYPE date USING _klinik_parse_legacy_date(tanggal_masuk);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='wbp' AND column_name='tgl_ekspirasi' AND data_type <> 'date') THEN
    ALTER TABLE wbp ALTER COLUMN tgl_ekspirasi TYPE date USING _klinik_parse_legacy_date(tgl_ekspirasi);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='wbp' AND column_name='tgl_surat_penahanan' AND data_type <> 'date') THEN
    ALTER TABLE wbp ALTER COLUMN tgl_surat_penahanan TYPE date USING _klinik_parse_legacy_date(tgl_surat_penahanan);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='kunjungan' AND column_name='tanggal' AND data_type <> 'date') THEN
    ALTER TABLE kunjungan ALTER COLUMN tanggal TYPE date USING COALESCE(_klinik_parse_legacy_date(tanggal), CURRENT_DATE);
  END IF;
END $$;

ALTER TABLE wbp ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE wbp ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
ALTER TABLE kunjungan ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE kunjungan ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
ALTER TABLE master_obat ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE master_obat ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
ALTER TABLE daftar_penyakit ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
ALTER TABLE referensi_icd10 ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
ALTER TABLE resep_obat ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
ALTER TABLE pengaturan_app ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'petugas_administrasi';
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE INDEX IF NOT EXISTS wbp_nik_idx ON wbp(nik);
CREATE UNIQUE INDEX IF NOT EXISTS wbp_nik_unique ON wbp(nik) WHERE nik IS NOT NULL AND nik <> '';
CREATE UNIQUE INDEX IF NOT EXISTS wbp_no_reg_unique ON wbp(no_reg_instansi) WHERE no_reg_instansi IS NOT NULL AND no_reg_instansi <> '';
CREATE INDEX IF NOT EXISTS kunjungan_tanggal_idx ON kunjungan(tanggal);
CREATE INDEX IF NOT EXISTS kunjungan_wbp_id_idx ON kunjungan(wbp_id);
CREATE INDEX IF NOT EXISTS referensi_keluhan_idx ON referensi_icd10(keluhan);
CREATE INDEX IF NOT EXISTS resep_kunjungan_idx ON resep_obat(kunjungan_id);
CREATE INDEX IF NOT EXISTS resep_obat_idx ON resep_obat(obat_id);
CREATE INDEX IF NOT EXISTS users_username_idx ON users(username);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kunjungan_wbp_id_fk') THEN
    UPDATE kunjungan SET wbp_id = NULL WHERE wbp_id IS NOT NULL AND wbp_id <> '' AND wbp_id NOT IN (SELECT id FROM wbp);
    ALTER TABLE kunjungan ADD CONSTRAINT kunjungan_wbp_id_fk FOREIGN KEY (wbp_id) REFERENCES wbp(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resep_kunjungan_fk') THEN
    DELETE FROM resep_obat WHERE kunjungan_id NOT IN (SELECT id FROM kunjungan);
    ALTER TABLE resep_obat ADD CONSTRAINT resep_kunjungan_fk FOREIGN KEY (kunjungan_id) REFERENCES kunjungan(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resep_obat_fk') THEN
    DELETE FROM resep_obat WHERE obat_id NOT IN (SELECT id FROM master_obat);
    ALTER TABLE resep_obat ADD CONSTRAINT resep_obat_fk FOREIGN KEY (obat_id) REFERENCES master_obat(id) ON DELETE RESTRICT;
  END IF;
EXCEPTION WHEN others THEN NULL; END $$;

COMMIT;
