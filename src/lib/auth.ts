/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type AppRole = 'admin' | 'dokter_perawat' | 'petugas_administrasi';

const SESSION_STORAGE_KEY = 'klinik_dompu_auth_session_v2';

export interface AuthSession {
  isAuthenticated: boolean;
  token: string;
  username: string;
  displayName?: string;
  role: AppRole;
  mustChangePassword: boolean;
  loginTime: number;
  rememberMe: boolean;
}

function getStorage(rememberMe: boolean) {
  return rememberMe ? localStorage : sessionStorage;
}

export async function loginWithCredentials(
  usernameInput: string,
  passwordInput: string,
  rememberMe: boolean
): Promise<{ success: boolean; message?: string; mustChangePassword?: boolean }> {
  const cleanUser = usernameInput.trim();
  const cleanPass = passwordInput;
  if (!cleanUser || !cleanPass) {
    return { success: false, message: 'Username dan kata sandi wajib diisi.' };
  }
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cleanUser, password: cleanPass, rememberMe }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, message: data?.error || 'Gagal masuk. Periksa username dan kata sandi.' };
    }
    const session: AuthSession = {
      isAuthenticated: true,
      token: data.token,
      username: data.user?.username || cleanUser,
      displayName: data.user?.displayName,
      role: (data.user?.role as AppRole) || 'petugas_administrasi',
      mustChangePassword: Boolean(data.user?.mustChangePassword),
      loginTime: Date.now(),
      rememberMe,
    };
    // clear other storage
    localStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    getStorage(rememberMe).setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    // clear legacy
    localStorage.removeItem('klinik_dompu_auth_session');
    sessionStorage.removeItem('klinik_dompu_auth_session');
    return { success: true, mustChangePassword: session.mustChangePassword };
  } catch (e: any) {
    return { success: false, message: 'Tidak dapat terhubung ke server. Periksa koneksi.' };
  }
}

export function getCurrentSession(): AuthSession | null {
  try {
    let raw = localStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(SESSION_STORAGE_KEY);
    // migrate legacy best-effort: legacy had no server token, force re-login
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.token) return null;
    const maxAge = parsed.rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    if (Date.now() - (parsed.loginTime || 0) > maxAge) {
      logoutSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getCurrentApiToken(): string | null {
  const s = getCurrentSession();
  return s?.token || null;
}

export function updateSessionFields(patch: Partial<AuthSession>) {
  const s = getCurrentSession();
  if (!s) return;
  const updated = { ...s, ...patch };
  const storage = s.rememberMe ? localStorage : sessionStorage;
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
}

export async function logoutSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem('klinik_dompu_auth_session');
    sessionStorage.removeItem('klinik_dompu_auth_session');
  } catch {}
}

export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; message?: string }> {
  const token = getCurrentApiToken();
  if (!token) return { success: false, message: 'Sesi tidak valid. Silakan masuk kembali.' };
  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, message: data?.error || 'Gagal mengganti kata sandi.' };
    updateSessionFields({ mustChangePassword: false });
    return { success: true };
  } catch {
    return { success: false, message: 'Tidak dapat terhubung ke server.' };
  }
}

export function hasRole(session: AuthSession | null, roles: AppRole[]): boolean {
  return !!session && roles.includes(session.role);
}
