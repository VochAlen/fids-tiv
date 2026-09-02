// components/toast.tsx
//
// ZAŠTO OVO POSTOJI:
// Analiza je pokazala da glavni operativni ekran za osoblje —
// app/admin/assign-checkin/page.tsx, gdje se dodjeljuju gate-ovi i
// check-in šalteri letovima — NIJE imao NIKAKVU vizuelnu potvrdu uspjeha
// ili neuspjeha akcije. Dodjela/uklanjanje su rađeni "optimistički" (UI se
// mijenja odmah), a kad bi mrežni poziv ka serveru pao (privremeni mrežni
// prekid, Redis circuit breaker otvoren, itd.), kod je tiho vraćao UI na
// prethodno stanje — stavka bi se pojavila pa NESTALA, bez ijedne poruke
// koja objašnjava zašto. Za osoblje na aerodromu to izgleda kao "sistem
// je glupirao", izaziva nepovjerenje i nepotrebne ponovljene klikove, a u
// najgorem slučaju osoblje MISLI da je dodjela prošla iako nije.
//
// Ova komponenta je izvučena iz već postojećeg (ali nigdje ponovo
// upotrijebljenog) Toast-a u app/admin/flights/pagestat.tsx, uopštena da
// prihvata VIŠE poruka odjednom (stack), jer assign-checkin panel može
// generisati nekoliko brzih akcija zaredom (npr. masovna dodjela).

import { useEffect, type JSX } from 'react';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning';

export interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
}

let toastIdCounter = 0;
export function nextToastId(): number {
  toastIdCounter += 1;
  return toastIdCounter;
}

const STYLES: Record<ToastType, { bg: string; icon: JSX.Element }> = {
  success: { bg: 'bg-green-600', icon: <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> },
  error:   { bg: 'bg-red-600',   icon: <XCircle className="w-5 h-5 flex-shrink-0" /> },
  warning: { bg: 'bg-yellow-600', icon: <AlertTriangle className="w-5 h-5 flex-shrink-0" /> },
};

function SingleToast({
  toast, onClose, durationMs,
}: { toast: ToastMessage; onClose: (id: number) => void; durationMs: number }) {
  useEffect(() => {
    const timer = setTimeout(() => onClose(toast.id), durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  const style = STYLES[toast.type];
  return (
    <div
      className={`${style.bg} text-white px-4 py-3 rounded-lg shadow-2xl flex items-center gap-2 min-w-[260px] max-w-sm animate-[slideIn_0.2s_ease-out]`}
      role="status"
    >
      {style.icon}
      <span className="text-sm font-medium leading-snug">{toast.message}</span>
    </div>
  );
}

// Grešku (error) ostavljamo malo duže vidljivom nego success/warning —
// osoblje mora stići da je pročita i eventualno ponovi akciju, dok
// success poruke ne treba da zadržavaju pažnju predugo.
const DEFAULT_DURATION_MS: Record<ToastType, number> = {
  success: 2_500,
  warning: 3_500,
  error: 5_000,
};

export function ToastStack({
  toasts, onDismiss,
}: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <SingleToast toast={t} onClose={onDismiss} durationMs={DEFAULT_DURATION_MS[t.type]} />
        </div>
      ))}
    </div>
  );
}

// Obrazac upotrebe u pozivaocu (npr. app/admin/assign-checkin/page.tsx):
//
//   const [toasts, setToasts] = useState<ToastMessage[]>([]);
//   const showToast = useCallback((message: string, type: ToastType) => {
//     setToasts(list => [...list, { id: nextToastId(), message, type }]);
//   }, []);
//   const dismissToast = useCallback((id: number) => {
//     setToasts(list => list.filter(t => t.id !== id));
//   }, []);
//   // ... u JSX-u: <ToastStack toasts={toasts} onDismiss={dismissToast} />

