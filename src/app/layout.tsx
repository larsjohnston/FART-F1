import './globals.css'
import type { Metadata, Viewport } from 'next'
import BottomNav from '@/components/BottomNav'
import ServiceWorker from '@/components/ServiceWorker'
import { PlayerProvider } from '@/lib/players/context'

// metadata.manifest is intentionally omitted — Next injects the manifest <link>
// automatically from app/manifest.ts.
export const metadata: Metadata = {
  applicationName: 'FART-F1',
  title: 'FART-F1',
  description: 'Fantasy F1 draft pool',
  appleWebApp: {
    capable: true,
    title: 'FART-F1',
    statusBarStyle: 'black-translucent',
  },
  // Legacy iOS standalone flag (Next emits the modern `mobile-web-app-capable`;
  // older iOS still keys off this one for fullscreen home-screen launch).
  other: { 'apple-mobile-web-app-capable': 'yes' },
}

export const viewport: Viewport = {
  themeColor: '#0d1117',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ maxWidth: 520, margin: '0 auto', minHeight: '100dvh', paddingBottom: 64 }}>
        <PlayerProvider>{children}</PlayerProvider>
        <BottomNav />
        <ServiceWorker />
      </body>
    </html>
  )
}
