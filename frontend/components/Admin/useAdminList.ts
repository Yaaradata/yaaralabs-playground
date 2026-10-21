'use client';

// Loads one page of an admin list for the current filters, and reloads when they change.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminApiError, type Query } from '../../lib/admin-api';

export const PAGE_SIZE = 25;

export function goToLoginOn401(err: unknown): boolean {
  if (err instanceof AdminApiError && err.status === 401) {
    window.location.replace('/admin/login');
    return true;
  }
  return false;
}

export function errorText(err: unknown): string {
  return err instanceof AdminApiError ? err.message : 'Something went wrong. Try again.';
}

export function useAdminList<T>(load: (q: Query) => Promise<T>, filters: Query) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const key = JSON.stringify(filters);
  const seq = useRef(0);

  // New filters start again from the first page
  useEffect(() => setOffset(0), [key]);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const result = await load({ ...JSON.parse(key), limit: PAGE_SIZE, offset });
      if (mine === seq.current) setData(result);
    } catch (err) {
      if (!goToLoginOn401(err) && mine === seq.current) setError(errorText(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [load, key, offset]);

  useEffect(() => {
    // Typing in a search box waits a moment before asking the server
    const t = setTimeout(reload, 250);
    return () => clearTimeout(t);
  }, [reload]);

  return { data, loading, error, offset, setOffset, reload };
}
