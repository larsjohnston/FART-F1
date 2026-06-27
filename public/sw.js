// FART-F1 service worker. Deliberately conservative: it exists mainly to make
// the app installable and to give a friendly offline page. It NEVER caches API
// or Supabase responses, so live standings / drafts are always fresh.
const VERSION = 'fart-f1-v1'
const PRECACHE = ['/offline.html', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// --- Web Push ---------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = {} }
  const title = data.title || 'FART-F1'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'fart-f1',
    data: { url: data.url || '/draft' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/draft'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) { c.navigate(target); return c.focus() }
      }
      return self.clients.openWindow(target)
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Only handle our own origin. Supabase, OpenF1, etc. pass straight through.
  if (url.origin !== self.location.origin) return
  // Never cache API routes — they must hit the network for live data.
  if (url.pathname.startsWith('/api/')) return

  // Page navigations: network-first, fall back to the offline page when down.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')))
    return
  }

  // Static build assets: stale-while-revalidate for snappy repeat loads.
  if (url.pathname.startsWith('/_next/static') || PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(request)
        const network = fetch(request).then((res) => {
          if (res && res.status === 200) cache.put(request, res.clone())
          return res
        }).catch(() => cached)
        return cached || network
      }),
    )
  }
})
