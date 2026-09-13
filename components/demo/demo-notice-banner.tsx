// components/demo/demo-notice-banner.tsx
//
// Trajan, upadljiv trojezični banner — koristi ga SVAKA /demo/* stranica
// (vidi app/demo/*/page.tsx). Namjerno NIJE zatvoriv/nestajuć — po
// zahtjevu, upozorenje mora biti prisutno na svakoj demo stranici, bez
// izuzetka, da niko ne pomisli da su prikazani letovi stvarni.
export function DemoNoticeBanner() {
  return (
    <div className="bg-amber-500 text-slate-950 px-4 py-3 text-center text-xs sm:text-sm font-bold leading-relaxed sticky top-0 z-30 shadow-lg">
      <div className="max-w-5xl mx-auto space-y-0.5">
        <div>⚠️ DEMO PRIKAZ — Svi letovi, kompanije i vremena na ovoj stranici su IZMIŠLJENI (testni podaci), ne stvarne informacije o letovima.</div>
        <div>⚠️ DEMO VIEW — All flights, airlines and times on this page are FICTIONAL (test data), not real flight information.</div>
        <div>⚠️ VISTA DE DEMOSTRACIÓN — Todos los vuelos, aerolíneas y horarios en esta página son FICTICIOS (datos de prueba), no información real de vuelos.</div>
      </div>
    </div>
  );
}
