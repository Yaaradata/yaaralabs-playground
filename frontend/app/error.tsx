'use client';

/** Any render error below the root layout: a friendly screen instead of "Application error". */

import ErrorScreen from '../components/ErrorScreen';

export default function RootError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  // Reload rather than reset(): the failed screen's data is fetched again from scratch
  return <ErrorScreen error={error} reset={() => window.location.reload()} />;
}
