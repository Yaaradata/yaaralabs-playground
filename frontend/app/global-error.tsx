'use client';

/**
 * An error in the root layout itself. It replaces the whole document, so it renders its own <html>
 * and <body> with inline styles (the app's stylesheet may not have loaded).
 */

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, system-ui, sans-serif', background: '#f7f5fa', color: '#010101' }}>
        <main role="alert" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ maxWidth: 420, width: '100%', background: '#fff', border: '1px solid #e3dbeb', borderRadius: 16, padding: 24, textAlign: 'center' }}>
            <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong on this screen.</h1>
            <p style={{ color: '#4b4b57', marginTop: 8 }}>Your work is saved.</p>
            <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{ background: '#9333ea', color: '#fff', border: 0, borderRadius: 12, padding: '10px 20px', fontWeight: 600, fontSize: 16, cursor: 'pointer' }}
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => window.location.assign('/projects')}
                style={{ background: '#fff', border: '1px solid #e3dbeb', borderRadius: 12, padding: '10px 20px', fontWeight: 600, fontSize: 16, color: '#010101', cursor: 'pointer' }}
              >
                Back to projects
              </button>
            </div>
            {error?.digest && <p style={{ marginTop: 16, fontSize: 14, color: '#8a8a96' }}>Reference: {error.digest}</p>}
          </div>
        </main>
      </body>
    </html>
  );
}
