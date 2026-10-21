'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { getToken } from '../../lib/admin-api';

/** /admin: straight to the dashboard when signed in, otherwise to login. */
export default function AdminIndex() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getToken() ? '/admin/dashboard' : '/admin/login');
  }, [router]);
  return <div className="min-h-screen bg-canvas" />;
}
