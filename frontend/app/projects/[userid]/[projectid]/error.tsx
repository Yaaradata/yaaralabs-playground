'use client';

/** A render error on a project screen (labs, Collect, Train, Use, Evaluate): keeps the header and app chrome. */

import ErrorScreen from '../../../../components/ErrorScreen';

export default function ProjectError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={() => window.location.reload()} />;
}
