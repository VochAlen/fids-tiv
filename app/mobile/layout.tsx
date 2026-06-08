// Dedicated layout for the mobile FIDS page.
// Overrides any parent layout that sets h-screen / overflow-hidden.
export default function FlightsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: 'auto', minHeight: '100dvh', overflow: 'visible' }}>
      {children}
    </div>
  )
}
