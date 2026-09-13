// app/pa/login/page.tsx — force-static wrapper (isti obrazac kao ostatak aplikacije)
import PaLoginClient from './PaLoginClient';

export const dynamic = 'force-static';

export default function Page() {
  return <PaLoginClient />;
}
