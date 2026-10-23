// lib/build-id.ts
//
// Identifikator trenutnog deploya. Server ga upisuje u HTML (app/layout.tsx → window.__BUILD_ID__) i vraća u
// odgovoru /api/test/assignments; kiosk poredi ta dva i sam se osvježi kad se razlikuju (vidi hooks/useKioskSupervisor.ts).
// Lokalno ('dev') se nikad ne poredi.
export const BUILD_ID = (process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 24);
