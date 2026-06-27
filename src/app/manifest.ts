import type { MetadataRoute } from 'next'

// Web App Manifest — makes FART-F1 installable to the home screen on iOS and
// Android and launch fullscreen (no browser chrome). Colors match the app theme
// in globals.css.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FART-F1 — Fantasy F1 Pool',
    short_name: 'FART-F1',
    description: 'Mobile-first fantasy F1 draft pool — draft 5 drivers each race, lowest score wins.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0d1117',
    theme_color: '#0d1117',
    categories: ['sports', 'games'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
