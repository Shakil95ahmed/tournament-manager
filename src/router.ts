import { useEffect, useState } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'create' }
  | { name: 'data' }
  | { name: 'tournament'; id: string }
  | { name: 'notFound'; path: string };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Hash-based routes keep GitHub Pages happy: the server only ever serves
 * index.html, so a refresh on `#/t/abc` can never produce a 404.
 */
export function parseHash(rawHash: string): Route {
  const withoutHash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  const path = withoutHash.split('?')[0] ?? '';
  const parts = path.split('/').filter((part) => part.length > 0);
  const head = parts[0];

  if (!head) return { name: 'dashboard' };
  if (head === 'create' && parts.length === 1) return { name: 'create' };
  if (head === 'data' && parts.length === 1) return { name: 'data' };
  if (head === 't' && parts.length === 2) {
    return { name: 'tournament', id: safeDecode(parts[1] ?? '') };
  }

  return { name: 'notFound', path: `/${parts.join('/')}` };
}

export function navigate(path: string): void {
  const normalized = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`;
  if (window.location.hash === normalized) return;
  window.location.hash = normalized;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const handleChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', handleChange);
    return () => window.removeEventListener('hashchange', handleChange);
  }, []);

  return route;
}
