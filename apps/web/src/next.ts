/**
 * Where to go after signing in (`?next=`): only a page of this site. A path starting with one "/",
 * not "//" or "/\" (which browsers read as another site), with no backslashes or control characters.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return '/';
  return next;
}
