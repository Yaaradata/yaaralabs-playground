/**
 * Chat message text -> the small HTML ChatMessage renders. Everything the user, the model or the
 * server wrote is escaped first; only the markup added here (<strong>, <br/>) is HTML. Before this,
 * "<img src=x onerror=alert(1)>" in a message ran a script and "<style>body{display:none}</style>"
 * blanked the app. Tested in scripts/test-xss.ts.
 */

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const bold = (s: string) => s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

export function formatContent(content: string): string {
  const safe = escapeHtml(content);
  // Several sentences ending with a full stop (e.g. guidelines): one sentence per line
  const sentences = safe.split(/\.\s+/).filter((s) => s.trim());
  if (sentences.length >= 2 && safe.trim().endsWith('.')) {
    return sentences.map((s) => bold(`${s.trim().replace(/\.$/, '')}.`)).join('<br/>');
  }
  return bold(safe);
}
