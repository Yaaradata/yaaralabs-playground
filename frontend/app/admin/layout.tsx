import type { Metadata } from 'next';

// The admin console: kept out of search results.
export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · YaaraLabs Playground' },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
