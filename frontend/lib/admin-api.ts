// Admin area (/admin): the signed-in admin's token and calls to the backend's /api/admin routes.
// The token is a JWT from /api/admin/login, kept in localStorage until it expires or a call answers 401.
import { config } from './config';

const TOKEN_KEY = 'yaaralabs_admin_token';
const EXPIRES_KEY = 'yaaralabs_admin_expires_at';
const ADMIN_KEY = 'yaaralabs_admin_profile';

export interface AdminProfile {
  email: string;
  name: string;
  role: string;
  active: boolean;
  created_at: string | null;
  last_login_at: string | null;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  admin: AdminProfile;
}

export interface Page<T> {
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

export interface AdminProject {
  id: string;
  name: string;
  type: string;
  status: string;
  session_id: string;
  created_by: string;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
  accuracy: number | null;
  trained_at: string | null;
}

export interface AdminSession {
  session_id: string;
  status: 'active' | 'expired' | 'inactive';
  created_at: string | null;
  expires_at: string | null;
  last_active: string | null;
  ip_address: string;
  user_agent: string;
  project_count: number;
}

export interface AdminModel {
  key: string;
  kind: 'text' | 'image';
  project_id: string;
  session_id: string;
  files: number;
  bytes: number;
  updated_at: string | null;
  orphaned: boolean;
}

export interface AdminStats {
  projects: { total: number; last_24h: number; guest: number; by_type: Record<string, number>; by_status: Record<string, number> };
  sessions: { total: number; active: number; expired: number; inactive: number; last_24h: number };
  models: { total: number; files: number; bytes: number; by_kind: Record<string, number> };
  admins: number;
  generated_at: string;
}

export interface AuditRow {
  at: string | null;
  admin: string;
  action: string;
  details: Record<string, unknown>;
}

export class AdminApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function saveSession(auth: AuthResponse): void {
  const s = storage();
  if (!s) return;
  s.setItem(TOKEN_KEY, auth.access_token);
  s.setItem(EXPIRES_KEY, auth.expires_at);
  s.setItem(ADMIN_KEY, JSON.stringify(auth.admin));
}

export function clearSession(): void {
  const s = storage();
  [TOKEN_KEY, EXPIRES_KEY, ADMIN_KEY].forEach((k) => s?.removeItem(k));
}

export function getToken(): string | null {
  const s = storage();
  const token = s?.getItem(TOKEN_KEY);
  const expires = s?.getItem(EXPIRES_KEY);
  if (!token || !expires || new Date(expires).getTime() <= Date.now()) {
    if (token) clearSession();
    return null;
  }
  return token;
}

export function getStoredAdmin(): AdminProfile | null {
  try {
    const raw = storage()?.getItem(ADMIN_KEY);
    return raw ? (JSON.parse(raw) as AdminProfile) : null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (!token) throw new AdminApiError(401, 'Please log in as an admin.');
    headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}/api/admin${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  } catch {
    throw new AdminApiError(0, "Can't reach the server. Check that the backend is running.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && auth) clearSession();
    const detail = typeof body?.detail === 'string' ? body.detail : Array.isArray(body?.detail) ? body.detail[0]?.msg : null;
    throw new AdminApiError(res.status, detail || `Request failed (${res.status}).`);
  }
  return body as T;
}

export type Query = Record<string, string | number | boolean | undefined | null>;

function qs(params: Query): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : '';
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const adminApi = {
  config: () => request<{ login_enabled: boolean; signup_enabled: boolean }>('/config', {}, false),
  signup: (body: { email: string; name: string; password: string; signup_code: string }) =>
    request<AuthResponse>('/signup', post(body), false),
  login: (body: { email: string; password: string }) => request<AuthResponse>('/login', post(body), false),
  me: () => request<AdminProfile>('/me'),
  admins: () => request<{ items: AdminProfile[] }>('/admins'),
  stats: () => request<AdminStats>('/stats'),
  projects: (q: Query) => request<Page<AdminProject> & { types: string[]; statuses: string[] }>(`/projects${qs(q)}`),
  sessions: (q: Query) => request<Page<AdminSession>>(`/sessions${qs(q)}`),
  models: (q: Query) => request<Page<AdminModel>>(`/models${qs(q)}`),
  audit: () => request<{ items: AuditRow[] }>('/audit'),

  deleteProject: (id: string) => request<Record<string, unknown>>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteProjects: (ids: string[]) => request<Record<string, unknown>>('/projects/delete', post({ ids })),
  deleteAllProjects: (confirm: string) => request<Record<string, unknown>>('/projects/delete-all', post({ confirm })),
  deleteSession: (id: string, includeProjects: boolean) =>
    request<Record<string, unknown>>(`/sessions/${encodeURIComponent(id)}?include_projects=${includeProjects}`, { method: 'DELETE' }),
  clearSessions: (body: { confirm?: string; session_ids?: string[]; expired_only?: boolean; include_projects?: boolean }) =>
    request<Record<string, unknown>>('/sessions/clear', post(body)),
  deleteModels: (keys: string[]) => request<Record<string, unknown>>('/models/delete', post({ keys })),
  deleteAllModels: (confirm: string) => request<Record<string, unknown>>('/models/delete-all', post({ confirm })),
  clearEverything: (confirm: string) => request<Record<string, unknown>>('/clear-everything', post({ confirm })),
};

export const CONFIRM = {
  allProjects: 'DELETE ALL PROJECTS',
  allSessions: 'CLEAR ALL SESSIONS',
  allModels: 'DELETE ALL MODELS',
  everything: 'CLEAR EVERYTHING',
};

export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A yyyy-mm-dd date input as an ISO bound: start of that day, or its end for the "to" side. */
export function dayBound(day: string, end = false): string | undefined {
  if (!day) return undefined;
  const d = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
