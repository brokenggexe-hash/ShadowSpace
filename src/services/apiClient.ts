import { auth } from '../config/firebase';

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const user = auth.currentUser;
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text };
  }

  if (!res.ok) {
    const rawError =
      json && typeof json === 'object' && 'error' in json
        ? String((json as { error: unknown }).error || '')
        : '';
    const msg = rawError || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json as T;
}
