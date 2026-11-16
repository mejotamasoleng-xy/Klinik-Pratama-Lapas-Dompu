/**
 * Date helpers: DB stores ISO yyyy-mm-dd for date columns; UI displays dd/mm/yyyy (WITA context where relevant).
 */

export function isoToDisplay(iso?: string | null): string {
  if (!iso) return '';
  const s = String(iso).trim();
  if (!s) return '';
  // already display format
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  // fallback: try Date
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yy = d.getUTCFullYear();
    return `${dd}/${mm}/${yy}`;
  }
  return s;
}

export function displayToIso(display?: string | null): string | null {
  if (display == null) return null;
  const s = String(display).trim();
  if (!s) return null;
  // ISO already
  const isoM = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoM) return `${isoM[1]}-${isoM[2]}-${isoM[3]}`;
  const parts = s.split('/');
  if (parts.length === 3) {
    let day = parseInt(parts[0], 10);
    let month = parseInt(parts[1], 10);
    let year = parseInt(parts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    if (year < 100) year += 2000;
    if (year < 1900 || year > 2100) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }
  return null;
}

export function todayIsoWita(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' });
  // en-CA gives yyyy-mm-dd
  return fmt.format(now);
}
