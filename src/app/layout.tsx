import './globals.css'
import BottomNav from '@/components/BottomNav'
import { PlayerProvider } from '@/lib/players/context'

export const metadata = { title: 'FART-F1', description: 'Fantasy F1 draft pool' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ maxWidth: 520, margin: '0 auto', minHeight: '100dvh', paddingBottom: 64 }}>
        <PlayerProvider>{children}</PlayerProvider>
        <BottomNav />
      </body>
    </html>
  )
}
