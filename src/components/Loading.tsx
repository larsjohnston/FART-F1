/** Centered spinner + label for the brief window before a page's data has
 *  loaded. Use this instead of rendering an empty-state ("no data") message,
 *  which is misleading while the fetch is still in flight. */
export default function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '48px 20px', color: 'var(--muted)',
    }}>
      <div className="spinner" />
      <div style={{ fontSize: 13 }}>{label}</div>
    </div>
  )
}
