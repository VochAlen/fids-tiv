// scripts/ably-token-check.mjs
// Pokretanje (iz korijena projekta, Node 20.6+):
//   node --env-file=.env.local scripts/ably-token-check.mjs
// Starije verzije Node-a:  set ABLY_API_KEY=...   pa   node scripts/ably-token-check.mjs
// Ne piše ništa u Redis niti u produkciju; samo traži jedan token od Ably-ja i otvara jednu konekciju.
import * as Ably from 'ably';
import http from 'http';

const key = process.env.ABLY_API_KEY;
if (!key) { console.error('Nedostaje ABLY_API_KEY'); process.exit(1); }

const rest = new Ably.Rest({ key });
const capability = { 'flights:combined': ['subscribe'], 'assignments:desks': ['subscribe'] }; // role=checkin
const t0 = Date.now();
const details = await rest.auth.requestToken({ capability, ttl: 12 * 3600 * 1000 });
console.log(`1) requestToken OK za ${Date.now() - t0} ms; polja: ${Object.keys(details).join(', ')}`);

const valid =
  typeof details.token === 'string' && details.token.length > 0 &&
  typeof details.issued === 'number' && typeof details.expires === 'number' &&
  details.expires - Date.now() > 11 * 3600 * 1000;
console.log(`2) prolazi zaštitu iz route.ts: ${valid ? 'DA' : 'NE  <-- ruta bi pala na TokenRequest'} | trajanje ${((details.expires - details.issued) / 3600000).toFixed(1)} h`);

// authUrl koji vraća TokenDetails kao JSON — isto što radi /api/ably-token
let hits = 0;
const srv = http.createServer((_req, res) => { hits++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(details)); }).listen(0);
const rt = new Ably.Realtime({ authUrl: `http://127.0.0.1:${srv.address().port}/api/ably-token?role=checkin`, httpRequestTimeout: 15000 });
const state = await new Promise((resolve) => {
  const to = setTimeout(() => resolve('TIMEOUT (' + rt.connection.state + ')'), 20000);
  rt.connection.on((s) => {
    if (['connected', 'failed', 'suspended', 'disconnected'].includes(s.current)) { clearTimeout(to); resolve(s.current + (s.reason ? ' — ' + s.reason.message : '')); }
  });
});
console.log(`3) Realtime konekcija sa TokenDetails preko authUrl: ${state} (authUrl pogodaka: ${hits})`);

try {
  const ch = rt.channels.get('assignments:desks');
  await ch.subscribe(() => {});
  console.log(`4) dozvoljen kanal assignments:desks: OK (${ch.state})`);
} catch (e) { console.log('4) dozvoljen kanal NIJE radio:', e.message); }

try {
  await rt.channels.get('assignments:gates').attach();
  console.log('5) zabranjen kanal assignments:gates se ATTACHOVAO  <-- capability ne radi kako treba');
} catch (e) { console.log(`5) zabranjen kanal odbijen kako treba (kod ${e.code})`); }

rt.close(); srv.close();
