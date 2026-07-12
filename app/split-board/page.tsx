// app/split-board/page.tsx
import SplitBoardPageClient from './SplitBoardPageClient';

export const dynamic = 'force-static';

export default function Page() {
  return <SplitBoardPageClient />;
}