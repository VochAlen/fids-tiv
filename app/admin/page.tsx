// app/admin/page.tsx
//
// FIX (portovano iz glavnog/polling sistema — nedostajalo je u
// potpunosti): /admin ruta uopšte nije postojala u ovom projektu (samo
// /admin/assign-checkin, /admin/pa, /admin/login, i layout.tsx) — bez
// ove stranice, posjeta /admin nije imala šta da prikaže. Tanka
// omotnica, isti obrazac kao ostale stranice u ovom projektu.
import AdminDashboardClient from './AdminDashboardClient';

export default function AdminPage() {
  return <AdminDashboardClient />;
}
