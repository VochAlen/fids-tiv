// postcss.config.mjs
//
// FIX (KRITIČNO — downgrade sa Tailwind v4 na v3): kiosk uređaji rade
// na Windows 7 računarima, zauvijek zaključani na Chrome 109 (Google je
// ukinuo Windows 7 podršku od Chrome 110 nadalje — ovi računari NIKAD
// neće moći dobiti noviji browser bez zamjene OS-a). Tailwind v4
// zvanično zahtijeva Chrome 111+ (koristi cascade layers, color-mix(),
// @property, oklch boje) — na Chrome 109 su se boje vidljivo lomile
// (prijavljeno na combined ekranu, vjerovatno kroz cijelu kiosk flotu).
//
// autoprefixer je OVDJE KRITIČAN (nije bio potreban za v4, koji ima
// ugrađen Lightning CSS): v3 sam ne dodaje vendor prefixe, a Chrome 109
// treba ih za pojedine CSS osobine. Bez ovoga, dio stilova bi i dalje
// mogao raditi nekonzistentno na tom tačno browseru.
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
