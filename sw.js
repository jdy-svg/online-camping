// Offline support for the installed app: everything the camp is made of (the page, its scripts,
// sounds and icons) is kept, so it opens and plays without a connection.
// - The page itself: fetched fresh when online (so updates arrive), the kept copy when offline.
// - Built scripts and styles (assets/, their names change with every build): kept copy first.
// - Everything else of ours (sounds, icons, manifest): the kept copy at once, refreshed in the
//   background, so a replaced file arrives by the next visit.
// - Other sites (the weather service) are never kept.
// The page tells us which files it loaded (see install.ts), so they are kept from the very first
// visit, and scripts from older builds are cleared away.
const CACHE = 'camp-v2';

// On install, keep the page and every file it names (its built script, styles, icons, manifest),
// read straight from the page, so the camp opens offline after a single visit.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      const res = await fetch('./', { cache: 'no-cache' });
      const html = await res.clone().text();
      await c.put('./', res);
      const named = [...html.matchAll(/(?:src|href)="(\.\/[^"#?]+)"/g)].map((m) => m[1]);
      await Promise.all(
        [...new Set(named)].map((u) =>
          c.add(u).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isBuilt = (url) => new URL(url).pathname.includes('/assets/');

self.addEventListener('message', (event) => {
  const urls = event.data && event.data.type === 'keep' ? event.data.urls : null;
  if (!Array.isArray(urls)) return;
  const mine = urls.filter((u) => new URL(u, self.location.href).origin === self.location.origin);
  event.waitUntil(
    caches.open(CACHE).then(async (c) => {
      // Keep each file the page uses (one failing does not stop the rest).
      await Promise.all(
        mine.map(async (u) => {
          if (await c.match(u)) return;
          try {
            const res = await fetch(u);
            if (res.ok) await c.put(u, res);
          } catch {
            // Offline right now: it is kept on a later visit.
          }
        }),
      );
      // Scripts and styles of earlier builds are no longer needed.
      const current = new Set(mine.filter(isBuilt).map((u) => new URL(u, self.location.href).href));
      if (current.size === 0) return;
      for (const req of await c.keys()) if (isBuilt(req.url) && !current.has(req.url)) await c.delete(req);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }
  const refresh = () =>
    fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    });
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit && isBuilt(req.url)) return hit;
      if (hit) {
        // Use the kept copy now; fetch a fresh one for next time.
        event.waitUntil(refresh().catch(() => undefined));
        return hit;
      }
      return refresh();
    }),
  );
});
