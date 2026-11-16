/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Settings,
  KeyRound,
  BookOpen,
  RefreshCw,
  UploadCloud,
  Clock,
  Palette,
  FileText,
  Trash2,
  Check,
  ShieldAlert,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { formatDateTimeWita, store, useStoreSync } from '../lib/storage';
import { BatchConfig } from '../types';
import ReferencesManager from './ReferencesManager';
import SidbUpdater from './SidbUpdater';
import DataImporter from './DataImporter';
import { getCurrentSession, changeMyPassword, getCurrentApiToken } from '../lib/auth';

export type SettingsSubTab =
  | 'keamanan'
  | 'pengguna'
  | 'referensi'
  | 'update_sidb'
  | 'impor_ekspor'
  | 'sering_berobat'
  | 'batch'
  | 'audit'
  | 'sampah'
  | 'hapus_semua';

type ManagedUser = {
  uid: string;
  username: string;
  displayName?: string;
  role: string;
  email?: string;
  mustChangePassword?: boolean;
  isActive?: boolean;
};

export default function SettingsModal() {
  const storeVersion = useStoreSync();
  const [activeTab, setActiveTab] = useState<SettingsSubTab>('keamanan');

  const session = getCurrentSession();
  const isAdmin = session?.role === 'admin';

  // Keamanan: Ganti Password
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [passMsg, setPassMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // User management (admin)
  const [usersList, setUsersList] = useState<ManagedUser[]>([]);
  const [userMsg, setUserMsg] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ username: '', displayName: '', email: '', role: 'petugas_administrasi', password: '' });

  // Sering Berobat
  const pengaturan = store.getPengaturan();
  const [batasKali, setBatasKali] = useState(pengaturan.batas_sering_berobat_kali);
  const [periodeHari, setPeriodeHari] = useState(pengaturan.periode_sering_hari);
  const [seringMsg, setSeringMsg] = useState(false);

  // Batches
  const [batches, setBatches] = useState<BatchConfig[]>(pengaturan.batches);
  const [newBatchName, setNewBatchName] = useState('');
  const [newBatchColor, setNewBatchColor] = useState('#F9CB9C');

  // Keep form settings synced if updated from another device
  useEffect(() => {
    const latest = store.getPengaturan();
    setBatasKali(latest.batas_sering_berobat_kali);
    setPeriodeHari(latest.periode_sering_hari);
    setBatches(latest.batches);
  }, [storeVersion]);

  // Soft Deleted Visits (Trash bin) & Audit logs
  const deletedVisits = store.getCalculatedKunjungan(true).filter((k) => k.dihapus);
  const auditLogs = store.getAuditLogs();

  const loadUsers = async () => {
    if (!isAdmin) return;
    try {
      const token = getCurrentApiToken();
      const res = await fetch('/api/auth/users', { headers: { Authorization: 'Bearer ' + token } });
      if (res.ok) setUsersList(await res.json());
    } catch {}
  };

  useEffect(() => { if (activeTab === 'pengguna') void loadUsers(); }, [activeTab, isAdmin]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserMsg(null);
    try {
      const token = getCurrentApiToken();
      const res = await fetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(newUser),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setUserMsg(data?.error || 'Gagal membuat pengguna.'); return; }
      setUserMsg('Pengguna berhasil dibuat. Wajib ganti kata sandi saat login pertama.');
      setNewUser({ username: '', displayName: '', email: '', role: 'petugas_administrasi', password: '' });
      await loadUsers();
    } catch { setUserMsg('Gagal menghubungi server.'); }
  };

  // Handle Change Password (server-side, per-user)
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassMsg(null);

    if (newPass.length < 8) {
      setPassMsg({ type: 'error', text: 'Kata sandi baru minimal 8 karakter.' });
      return;
    }
    if (newPass !== confirmPass) {
      setPassMsg({ type: 'error', text: 'Konfirmasi kata sandi tidak cocok.' });
      return;
    }

    const res = await changeMyPassword(currentPass, newPass);
    if (res.success) {
      setPassMsg({ type: 'success', text: 'Kata sandi berhasil diperbarui.' });
      setCurrentPass('');
      setNewPass('');
      setConfirmPass('');
    } else {
      setPassMsg({ type: 'error', text: res.message || 'Gagal mengganti kata sandi.' });
    }
  };

  // Handle Save Sering Berobat
  const handleSaveSering = (e: React.FormEvent) => {
    e.preventDefault();
    store.updatePengaturan({
      batas_sering_berobat_kali: Number(batasKali),
      periode_sering_hari: Number(periodeHari),
    });
    setSeringMsg(true);
    setTimeout(() => setSeringMsg(false), 2500);
  };

  // Handle Add Batch
  const handleAddBatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBatchName.trim()) return;
    const updated = [...batches, { nama: newBatchName.trim(), warna: newBatchColor }];
    setBatches(updated);
    store.updatePengaturan({ batches: updated });
    setNewBatchName('');
  };

  const handleDeleteBatch = (nama: string) => {
    const updated = batches.filter((b) => b.nama !== nama);
    setBatches(updated);
    store.updatePengaturan({ batches: updated });
  };

  const handleRestoreVisit = (id: string) => {
    store.restoreKunjungan(id);
  };

  const handlePermanentDelete = (id: string) => {
    if (confirm('Hapus permanen data kunjungan ini?')) {
      store.permanentDeleteKunjungan(id);
    }
  };

  // State for data clearance feedback
  const [clearActionMsg, setClearActionMsg] = useState<string | null>(null);

  const handleClearAllVisits = async () => {
    const phrase = window.prompt('Ketik "HAPUS SEMUA KUNJUNGAN" untuk mengonfirmasi penghapusan seluruh data kunjungan.');
    if (phrase !== 'HAPUS SEMUA KUNJUNGAN') return;
    try {
      await store.clearAllKunjungan(phrase);
      setClearActionMsg('Semua catatan kunjungan harian berhasil dibersihkan di server.');
    } catch (e: any) {
      setClearActionMsg(e?.message || 'Gagal menghapus data kunjungan.');
    }
  };

  const handleClearAllWbp = async () => {
    const phrase = window.prompt('Ketik "HAPUS SEMUA WBP" untuk mengonfirmasi penghapusan seluruh data WBP dan kunjungan.');
    if (phrase !== 'HAPUS SEMUA WBP') return;
    try {
      await store.clearAllWbp(phrase);
      setClearActionMsg('Seluruh data WBP dan kunjungan terkait berhasil dihapus di server.');
    } catch (e: any) {
      setClearActionMsg(e?.message || 'Gagal menghapus data WBP.');
    }
  };

  const handleFactoryReset = async () => {
    const phrase = window.prompt('Ketik "RESET PABRIK" untuk mengonfirmasi reset sistem. (Dinonaktifkan di produksi)');
    if (phrase !== 'RESET PABRIK') return;
    try {
      await store.resetAllData(phrase);
      setClearActionMsg('Sistem berhasil di-reset ke konfigurasi awal.');
    } catch (e: any) {
      setClearActionMsg(e?.message || 'Gagal mereset sistem.');
    }
  };

  const tabs: { id: SettingsSubTab; label: string; icon: any; count?: number; adminOnly?: boolean }[] = [
    { id: 'keamanan', label: 'Ganti Kata Sandi', icon: KeyRound },
    { id: 'pengguna', label: 'Akun Petugas', icon: ShieldAlert, adminOnly: true },
    { id: 'referensi', label: 'Referensi ICD-10', icon: BookOpen },
    { id: 'update_sidb', label: 'Update WBP (SIDB)', icon: RefreshCw },
    { id: 'impor_ekspor', label: 'Impor & Ekspor Cadangan', icon: UploadCloud },
    { id: 'sering_berobat', label: 'Batas Sering Berobat', icon: Clock },
    { id: 'batch', label: 'Daftar Batch BPJS', icon: Palette },
    { id: 'audit', label: 'Riwayat Audit Log', icon: FileText, count: auditLogs.length, adminOnly: true },
    { id: 'sampah', label: 'Kotak Sampah', icon: Trash2, count: deletedVisits.length },
    { id: 'hapus_semua', label: 'Hapus & Bersihkan Data', icon: Trash2, adminOnly: true },
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
        <div className="flex items-center gap-2.5">
          <Settings className="w-5 h-5 text-teal-700 dark:text-teal-400" />
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Pengaturan Sistem & Master Data
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Kelola kredensial akun, kamus keluhan ICD-10, sinkronisasi SIDB, cadangan data, dan preferensi klinis.
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex flex-wrap items-center gap-1.5 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* SUB-TAB 1: GANTI KATA SANDI */}
      {activeTab === 'keamanan' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 max-w-lg shadow-xs space-y-4">
          <div className="p-3 rounded-lg bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900/60 text-xs text-teal-900 dark:text-teal-200 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Keamanan Akun Petugas</p>
              <p className="text-[11px] text-teal-700 dark:text-teal-400 mt-0.5">
                Setiap petugas menggunakan akun pribadi dengan peran masing-masing. Ganti kata sandi Anda secara berkala untuk menjaga keamanan rekam medis.
              </p>
            </div>
          </div>

          {passMsg && (
            <div
              className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                passMsg.type === 'success'
                  ? 'bg-teal-100 text-teal-900 border border-teal-200'
                  : 'bg-rose-100 text-rose-900 border border-rose-200'
              }`}
            >
              {passMsg.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              <span>{passMsg.text}</span>
            </div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Kata Sandi Saat Ini *
              </label>
              <input
                type="password"
                required
                value={currentPass}
                onChange={(e) => setCurrentPass(e.target.value)}
                placeholder="Masukkan kata sandi lama"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Kata Sandi Baru *
              </label>
              <input
                type="password"
                required
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="Minimal 8 karakter"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Ulangi Kata Sandi Baru *
              </label>
              <input
                type="password"
                required
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                placeholder="Konfirmasi kata sandi baru"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 text-white font-semibold text-xs rounded-lg transition-colors shadow-xs"
            >
              Simpan Kata Sandi Baru
            </button>
          </form>
        </div>
      )}

      {/* SUB-TAB: AKUN PETUGAS (ADMIN) */}
      {activeTab === 'pengguna' && isAdmin && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">Akun Petugas & Peran</h3>
            <p className="text-xs text-slate-500 mt-0.5">Buat akun per petugas. Pengguna baru wajib mengganti kata sandi saat login pertama.</p>
          </div>
          {userMsg && <div className="p-2.5 rounded-lg text-xs bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">{userMsg}</div>}
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <input required value={newUser.username} onChange={e=>setNewUser({...newUser, username:e.target.value})} placeholder="Username *" className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
            <input value={newUser.displayName} onChange={e=>setNewUser({...newUser, displayName:e.target.value})} placeholder="Nama tampil" className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
            <input type="email" value={newUser.email} onChange={e=>setNewUser({...newUser, email:e.target.value})} placeholder="Email (opsional)" className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
            <select value={newUser.role} onChange={e=>setNewUser({...newUser, role:e.target.value})} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <option value="admin">Admin</option>
              <option value="dokter_perawat">Dokter / Perawat</option>
              <option value="petugas_administrasi">Petugas Administrasi</option>
            </select>
            <input required type="password" minLength={8} value={newUser.password} onChange={e=>setNewUser({...newUser, password:e.target.value})} placeholder="Kata sandi awal (min. 8) *" className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 sm:col-span-2" />
            <button type="submit" className="sm:col-span-2 py-2.5 bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-lg">Buat Akun Petugas</button>
          </form>
          <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
            <h4 className="text-xs font-semibold mb-2">Daftar pengguna</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-slate-800"><tr><th className="py-2 px-3">Username</th><th className="py-2 px-3">Nama</th><th className="py-2 px-3">Peran</th><th className="py-2 px-3">Status</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {usersList.map(u => (
                    <tr key={u.uid}><td className="py-2 px-3 font-mono">{u.username}</td><td className="py-2 px-3">{u.displayName||'-'}</td><td className="py-2 px-3">{u.role}</td><td className="py-2 px-3">{u.mustChangePassword?'Wajib ganti sandi':(u.isActive!==false?'Aktif':'Nonaktif')}</td></tr>
                  ))}
                  {usersList.length===0 && <tr><td colSpan={4} className="py-4 text-center text-slate-400">Belum ada data / tidak dapat memuat.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'referensi' && <ReferencesManager />}

      {/* SUB-TAB 3: UPDATE WBP DARI SIDB (MOVED HERE) */}
      {activeTab === 'update_sidb' && <SidbUpdater />}

      {/* SUB-TAB 4: IMPOR & EKSPOR CADANGAN (MOVED HERE) */}
      {activeTab === 'impor_ekspor' && <DataImporter />}

      {/* SUB-TAB 5: BATAS SERING BEROBAT */}
      {activeTab === 'sering_berobat' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 max-w-lg shadow-xs space-y-4">
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Ambang Batas "Sering Berobat"
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Warga binaan yang berobat melebihi frekuensi ini akan ditandai dengan peringatan khusus pada formulir dan rekap klinis.
            </p>
          </div>

          {seringMsg && (
            <div className="p-3 rounded-lg bg-teal-100 text-teal-900 text-xs flex items-center gap-2">
              <Check className="w-4 h-4" />
              <span>Pengaturan ambang batas berhasil disimpan.</span>
            </div>
          )}

          <form onSubmit={handleSaveSering} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Batas Jumlah Kunjungan (Kali)
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={batasKali}
                  onChange={(e) => setBatasKali(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Periode Rentang Waktu (Hari)
                </label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={periodeHari}
                  onChange={(e) => setPeriodeHari(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-400 italic">
              Standar klinis Lapas: 7 kali dalam rentang 7 hari terakhir.
            </p>

            <button
              type="submit"
              className="py-2 px-5 bg-teal-700 hover:bg-teal-800 text-white font-semibold text-xs rounded-lg shadow-xs"
            >
              Simpan Pengaturan
            </button>
          </form>
        </div>
      )}

      {/* SUB-TAB 6: BATCH BPJS & WARNA PENANDA */}
      {activeTab === 'batch' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Daftar Batch BPJS & Warna Penanda
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Warna ini digunakan secara konsisten pada DATA_WBP, Input Harian, dan Dashboard BPJS.
            </p>
          </div>

          <div className="space-y-2">
            {batches.map((b) => (
              <div
                key={b.nama}
                className="p-3 rounded-lg border flex items-center justify-between text-xs"
                style={{
                  backgroundColor: `${b.warna}22`,
                  borderColor: `${b.warna}88`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-4 h-4 rounded border shrink-0"
                    style={{ backgroundColor: b.warna, borderColor: '#64748B' }}
                  />
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white">{b.nama}</span>
                    <span className="font-mono text-slate-400 text-[11px] ml-2">({b.warna})</span>
                  </div>
                </div>

                {b.nama !== 'Belum masuk batch' && b.nama !== 'Tidak masuk batch' && (
                  <button
                    type="button"
                    onClick={() => handleDeleteBatch(b.nama)}
                    className="text-slate-400 hover:text-rose-600 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Add Batch Form */}
          <form onSubmit={handleAddBatch} className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <input
              type="text"
              placeholder="Nama Batch Baru (misal: Desember)"
              value={newBatchName}
              onChange={(e) => setNewBatchName(e.target.value)}
              className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg flex-1 text-slate-900 dark:text-white"
            />
            <input
              type="color"
              value={newBatchColor}
              onChange={(e) => setNewBatchColor(e.target.value)}
              className="w-10 h-8 rounded border border-slate-300 cursor-pointer"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white font-semibold text-xs rounded-lg flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Batch</span>
            </button>
          </form>
        </div>
      )}

      {/* SUB-TAB 7: AUDIT LOGS */}
      {activeTab === 'audit' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Riwayat Perubahan & Audit Log Petugas ({auditLogs.length} Entri)
            </h3>
          </div>

          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 dark:bg-slate-800 font-semibold border-b">
                <tr>
                  <th className="py-2 px-3 w-40">Waktu</th>
                  <th className="py-2 px-3 w-36">Aksi</th>
                  <th className="py-2 px-3">Rincian Perubahan</th>
                  <th className="py-2 px-3 w-32">Perangkat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {auditLogs.length > 0 ? (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-mono text-slate-500 whitespace-nowrap">
                        {formatDateTimeWita(log.waktu)}
                      </td>
                      <td className="py-2 px-3 font-bold text-teal-800 dark:text-teal-300">
                        {log.aksi}
                      </td>
                      <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                        {log.rincian}
                      </td>
                      <td className="py-2 px-3 text-slate-400 text-[11px]">
                        {log.perangkat || '-'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400">
                      Belum ada riwayat aktivitas tercatat
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 8: KOTAK SAMPAH (SOFT DELETED) */}
      {activeTab === 'sampah' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Kotak Sampah Kunjungan (Bisa Dipulihkan)
            </h3>
            <p className="text-xs text-slate-500">
              Kunjungan yang terhapus secara lunak dapat dikembalikan sewaktu-waktu tanpa kehilangan riwayat.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 dark:bg-slate-800 font-semibold border-b">
                <tr>
                  <th className="py-2 px-3">Tanggal</th>
                  <th className="py-2 px-4">Nama Pasien</th>
                  <th className="py-2 px-3">Keluhan</th>
                  <th className="py-2 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {deletedVisits.length > 0 ? (
                  deletedVisits.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-mono">{v.tanggal}</td>
                      <td className="py-2 px-4 font-bold">{v.nama}</td>
                      <td className="py-2 px-3 text-slate-600">
                        {[v.keluhan1, v.keluhan2, v.keluhan3].filter(Boolean).join(', ')}
                      </td>
                      <td className="py-2 px-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => handleRestoreVisit(v.id)}
                          className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded text-[11px] font-semibold"
                        >
                          Pulihkan
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePermanentDelete(v.id)}
                          className="px-2 py-1 text-rose-600 hover:underline text-[11px]"
                        >
                          Hapus Permanen
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400">
                      Kotak sampah kosong. Tidak ada kunjungan yang dihapus.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 9: HAPUS SEMUA & BERSIHKAN DATA */}
      {activeTab === 'hapus_semua' && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-rose-200 dark:border-rose-950/80 p-6 shadow-xs space-y-6">
          <div>
            <div className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-600" />
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Menu Hapus & Bersihkan Data Sistem
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Gunakan menu ini jika Anda ingin mengosongkan data lama sebelum mengimpor file baru yang bersih, atau mereset data uji coba.
            </p>
          </div>

          {clearActionMsg && (
            <div className="p-3.5 rounded-lg bg-teal-50 border border-teal-200 text-teal-900 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-teal-600 shrink-0" />
              <span>{clearActionMsg}</span>
            </div>
          )}

          <div className="space-y-4">
            {/* Opsi 1: Hapus Semua Kunjungan */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  Hapus Semua Riwayat Kunjungan Harian ({store.getRawKunjungan().length} Catatan)
                </h4>
                <p className="text-[11px] text-slate-500 mt-1 max-w-xl">
                  Mengosongkan seluruh baris input harian pelayanan medis. Seluruh master data WBP, NIK, dan kamar tetap aman. Sangat cocok jika Anda ingin mengimpor ulang file Excel Input Harian dari awal.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearAllVisits}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shrink-0 shadow-xs transition-colors"
              >
                Hapus Semua Kunjungan
              </button>
            </div>

            {/* Opsi 2: Hapus Semua WBP */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Hapus Semua Data Pasien (WBP) ({store.getWbpList().length} Orang)
                </h4>
                <p className="text-[11px] text-slate-500 mt-1 max-w-xl">
                  Mengosongkan direktori warga binaan dan data kunjungan berobat. Gunakan opsi ini jika Anda ingin mengganti total seluruh daftar narapidana dan tahanan dengan file DATA_WBP yang baru.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearAllWbp}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shrink-0 shadow-xs transition-colors"
              >
                Hapus Semua WBP
              </button>
            </div>

            {/* Opsi 3: Factory Reset */}
            <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-bold text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-600" />
                  Reset Total Sistem ke Bawaan Awal (Factory Reset)
                </h4>
                <p className="text-[11px] text-rose-700/80 dark:text-rose-400 mt-1 max-w-xl">
                  Mengembalikan aplikasi ke pengaturan dan data percontohan standar bawaan (default klinik Lapas Dompu).
                </p>
              </div>
              <button
                type="button"
                onClick={handleFactoryReset}
                className="px-4 py-2 bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg shrink-0 shadow-xs transition-colors"
              >
                Reset ke Pengaturan Awal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
