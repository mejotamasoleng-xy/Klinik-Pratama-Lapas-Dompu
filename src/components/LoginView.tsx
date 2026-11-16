/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Eye, EyeOff, Lock, User, AlertCircle, ShieldCheck } from 'lucide-react';
import { loginWithCredentials } from '../lib/auth';

interface LoginViewProps {
  onLoginSuccess: (mustChangePassword: boolean) => void;
}

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await loginWithCredentials(username, password, rememberMe);
      if (res.success) {
        onLoginSuccess(Boolean(res.mustChangePassword));
      } else {
        setErrorMsg(res.message || 'Gagal masuk. Periksa kembali username dan kata sandi.');
      }
    } catch {
      setErrorMsg('Terjadi kesalahan pada sistem saat memproses login.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100/80 dark:from-slate-950 dark:to-slate-900 px-3 sm:px-4 py-6 sm:py-8">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 sm:p-8">
        <div className="text-center mb-6">
          <img src="/logo.png" alt="Logo Klinik Pratama Lapas Kelas IIB Dompu" className="h-14 sm:h-16 w-auto mx-auto object-contain mb-2" />
          <p className="text-xs text-slate-500 dark:text-slate-400">Sistem Informasi Rekam Medis & Pelayanan Kesehatan WBP</p>
          <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 px-2.5 py-1 rounded-full">
            <ShieldCheck className="w-3.5 h-3.5" /> Akses petugas terautentikasi
          </div>
        </div>

        {errorMsg ? (
          <div className="mb-6 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Username Petugas</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400"><User className="w-4 h-4" /></div>
              <input type="text" autoComplete="username" required disabled={loading} value={username}
                onChange={(e) => setUsername(e.target.value)} placeholder="Masukkan username"
                className="w-full min-h-[44px] pl-10 pr-3 py-2.5 text-base sm:text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Kata Sandi</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400"><Lock className="w-4 h-4" /></div>
              <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required disabled={loading} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="Masukkan kata sandi"
                className="w-full min-h-[44px] pl-10 pr-11 py-2.5 text-base sm:text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600" />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'} tabIndex={-1}>
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-600 dark:text-slate-400 py-1">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-teal-600" />
              <span>Ingat saya di perangkat ini</span>
            </label>
          </div>
          <button type="submit" disabled={loading}
            className="w-full min-h-[46px] mt-2 py-3 px-4 bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white font-semibold text-sm rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2">
            {loading ? 'Memverifikasi...' : 'Masuk'}
          </button>
        </form>
        <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 text-center">
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Gunakan akun petugas yang telah terdaftar. Hubungi admin jika lupa kata sandi.</p>
        </div>
      </div>
    </div>
  );
}
