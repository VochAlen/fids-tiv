
// Mobile FIDS layout — unlocks scroll from any parent that sets h-screen/overflow-hidden
export default function MobileFIDSLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: 'auto',
        minHeight: '100dvh',
        overflow: 'visible',
        background: '#F7F8FA',
      }}
    >
      {children}
    </div>
  )
}
 