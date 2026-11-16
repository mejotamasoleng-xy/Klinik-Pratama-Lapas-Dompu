/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useState, useEffect } from 'react';
import Header from './components/Header';
import Sidebar, { TabKey } from './components/Sidebar';
import LoginView from './components/LoginView';
import { getCurrentSession, logoutSession, changeMyPassword } from './lib/auth';
import { getTodayFormatted, store, useStoreSync } from './lib/storage';
import { WbpItem } from './types';

const DailyInput = lazy(() => import('./components/DailyInput'));
const WbpDirectory = lazy(() => import('./components/WbpDirectory'));
const MonthlyRecap = lazy(() => import('./components/MonthlyRecap'));
const BpjsDashboard = lazy(() => import('./components/BpjsDashboard'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const MasterObat = lazy(() => import('./components/MasterObat'));
const LaporanObat = lazy(() => import('./components/LaporanObat'));
const SettingsModal = lazy(() => import('./components/SettingsModal'));
const MedicalRecordModal = lazy(() => import('./components/MedicalRecordModal'));

function ForceChangePassword({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) return setMsg('Kata sandi baru minimal 8 karakter.');
    if (next !== confirm) return setMsg('Konfirmasi kata sandi tidak cocok.');
    setLoading(true);
    const r = await changeMyPassword(current, next);
    setLoading(false);
    if (r.success) onDone();
    else setMsg(r.message || 'Gagal mengganti kata sandi.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <form onSubmit={submit} className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Ganti Kata Sandi</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Ini adalah login pertama atau kata sandi Anda perlu diperbarui. Silakan buat kata sandi baru sebelum melanjutkan.</p>
        {msg && <div className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg p-2.5">{msg}</div>}
        <div>
          <label className="block text-xs font-semibold mb-1">Kata sandi saat ini / sementara</label>
          <input type="password" value={current} onChange={e=>setCurrent(e.target.value)} required className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800" />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1">Kata sandi baru (min. 8 karakter)</label>
          <input type="password" value={next} onChange={e=>setNext(e.target.value)} required minLength={8} className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800" />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1">Konfirmasi kata sandi baru</label>
          <input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} required className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800" />
        </div>
        <button type="submit" disabled={loading} className="w-full bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-xl py-2.5 disabled:opacity-60">{loading?'Menyimpan...':'Simpan & Lanjutkan'}</button>
        <button type="button" onClick={()=>{ logoutSession(); onDone(); }} className="w-full text-sm text-slate-500 hover:text-slate-700">Keluar</button>
      </form>
    </div>
  );
}

export default function App() {
  const storeVersion = useStoreSync();
  const [session, setSession] = useState(() => getCurrentSession());
  const [activeTab, setActiveTab] = useState<TabKey>('input');
  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('klinik_dompu_theme') === 'dark');
  const [selectedPatientForRecord, setSelectedPatientForRecord] = useState<WbpItem | null>(null);
  const [counts, setCounts] = useState({ todayVisits: 0, totalWbp: 0, pendingBpjs: 0, flaggedSidb: 0 });

  const isAuthenticated = !!session?.token;

  const updateCounts = () => {
    const todayStr = getTodayFormatted();
    const visits = store.getCalculatedKunjungan(false);
    const wbps = store.getWbpList();
    setCounts({
      todayVisits: visits.filter((k) => k.tanggal === todayStr).length,
      totalWbp: wbps.length,
      pendingBpjs: wbps.filter((w) => w.batch_bpjs === 'Belum masuk batch').length,
      flaggedSidb: wbps.filter((w) => w.perlu_dicek).length,
    });
  };

  useEffect(() => { if (isAuthenticated && !session?.mustChangePassword) { window.dispatchEvent(new Event('klinik:auth-ready')); updateCounts(); } }, [isAuthenticated, activeTab, storeVersion, session?.mustChangePassword]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('klinik_dompu_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    const onAuthErr = () => { logoutSession(); setSession(null); };
    window.addEventListener('klinik:auth-error', onAuthErr as any);
    return () => window.removeEventListener('klinik:auth-error', onAuthErr as any);
  }, []);

  const handleLogout = () => { logoutSession(); setSession(null); };

  if (!isAuthenticated) {
    return <LoginView onLoginSuccess={() => { const s = getCurrentSession(); setSession(s); if (s?.token) window.dispatchEvent(new Event('klinik:auth-ready')); }} />;
  }

  if (session?.mustChangePassword) {
    return <ForceChangePassword onDone={() => { const s = getCurrentSession(); setSession(s); if (s?.token) window.dispatchEvent(new Event('klinik:auth-ready')); }} />;
  }

  const freshSelectedPatient = selectedPatientForRecord ? store.getWbpById(selectedPatientForRecord.id) || selectedPatientForRecord : null;

  const tabLabels: Record<TabKey, string> = {
    input: 'Input Harian Pelayanan Medis',
    pasien: 'Direktori Data Warga Binaan (DATA_WBP)',
    rekap: 'Laporan Rekapitulasi Penyakit Bulanan',
    bpjs: 'Dashboard Pengalihan Faskes BPJS',
    dashboard: 'Dashboard Analisis Klinis & Diagram Bulat',
    master_obat: 'Master Obat & Sediaan',
    laporan_obat: 'Laporan Pengeluaran Obat',
    pengaturan: 'Pengaturan Sistem & Master Data',
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col antialiased">
      <Header
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((c) => !c)}
        onOpenSettings={() => setActiveTab('pengaturan')}
        onLogout={handleLogout}
        onSelectPatient={(wbp) => setSelectedPatientForRecord(wbp)}
        activeTabLabel={tabLabels[activeTab]}
      />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} counts={counts} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 lg:pb-8">
          <div className="max-w-7xl mx-auto">
            <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Memuat halaman…</div>}>
              {activeTab === 'input' && <DailyInput onOpenMedicalRecord={setSelectedPatientForRecord} onRefreshData={updateCounts} />}
              {activeTab === 'pasien' && <WbpDirectory onSelectWbp={setSelectedPatientForRecord} />}
              {activeTab === 'rekap' && <MonthlyRecap />}
              {activeTab === 'bpjs' && <BpjsDashboard />}
              {activeTab === 'dashboard' && <Dashboard onNavigateToTab={setActiveTab} onSelectWbp={setSelectedPatientForRecord} />}
              {activeTab === 'master_obat' && <MasterObat />}
              {activeTab === 'laporan_obat' && <LaporanObat />}
              {activeTab === 'pengaturan' && <SettingsModal />}
              {freshSelectedPatient && <MedicalRecordModal wbp={freshSelectedPatient} onClose={() => setSelectedPatientForRecord(null)} />}
            </Suspense>
          </div>
        </main>
      </div>
      <footer className="border-t border-slate-200 dark:border-slate-700/70 bg-white dark:bg-slate-900 px-4 py-3 text-center text-xs text-slate-500 dark:text-slate-400">
        Made with <span aria-label="love">❤️</span> by Joshua | © 2026
      </footer>
    </div>
  );
}
