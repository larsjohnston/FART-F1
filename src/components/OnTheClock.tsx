'use client'

export default function OnTheClock({ name, yours }: { name: string | null; yours: boolean }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'var(--panel)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '1px solid var(--line)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'var(--live)',
          boxShadow: '0 0 8px var(--live)',
        }}
      />
      <span style={{ fontSize: 13 }}>
        {name ? (
          <>
            On the clock: <b>{name}</b>
            {yours ? ' — your pick!' : ''}
          </>
        ) : (
          'Draft complete 🏁'
        )}
      </span>
    </div>
  )
}
