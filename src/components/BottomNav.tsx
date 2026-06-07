'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/draft', label: 'Draft' },
  { href: '/standings', label: 'Standings' },
  { href: '/admin', label: 'Admin' },
]

export default function BottomNav() {
  const path = usePathname()
  return (
    <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: 520, margin: '0 auto',
      display: 'flex', background: 'var(--panel)', borderTop: '1px solid var(--line)' }}>
      {TABS.map(t => {
        const active = path?.startsWith(t.href) ?? false
        return (
          <Link key={t.href} href={t.href} style={{ flex: 1, textAlign: 'center', padding: '11px 0',
            fontSize: 12, color: active ? 'var(--text)' : 'var(--muted)',
            borderTop: active ? '2px solid var(--accent)' : '2px solid transparent', textDecoration: 'none' }}>
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
