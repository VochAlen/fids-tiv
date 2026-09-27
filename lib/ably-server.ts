// lib/ably-server.ts
import Ably from 'ably';

let restClient: Ably.Rest | null = null;

export function getAblyRest(): Ably.Rest {
  if (!restClient) {
    const key = process.env.ABLY_API_KEY;
    if (!key) throw new Error('ABLY_API_KEY nije postavljen');
    restClient = new Ably.Rest({ key });
  }
  return restClient;
}

// NOVO (po zahtjevu — nastavak dijagnostike "Ably publish garancije",
// 2026-09-27): ranije je ovo bio TAČNO JEDAN pokušaj — svaki prolazan
// mrežni "blip" između Vercel funkcije i Ably servisa (rijedak, ali
// stvaran — isti razred problema kao i za Redis) je značio da se
// realtime obavještenje kioscima NIKAD nije ni pokušalo ponovo, i
// oslanjao se ISKLJUČIVO na sledeći periodičan reconciliation fetch
// (do 3 min kašnjenja, vidi RECONCILE_INTERVAL_MS u
// hooks/useRealtimeAssignments.ts) da se kiosk sam ispravi. To je i
// dalje sigurnosna mreža koja postoji, ali nema razloga da se ne
// pokuša BAR još jednom, odmah, prije nego što se na nju oslonimo —
// jedan kratak retry pokriva veliku većinu prolaznih "blip"-ova bez
// икакvog dodatnog rizika (poziv je već fire-and-forget iz ugla
// response-a, preko after() u pozivnim rutama).
const PUBLISH_RETRY_DELAY_MS = 300;

export async function publishToChannel(channelName: string, eventName: string, data: unknown): Promise<void> {
  const client = getAblyRest();
  const channel = client.channels.get(channelName);
  try {
    await channel.publish(eventName, data);
  } catch (err) {
    console.warn(`[ably-server] Prvi pokušaj publish-a na "${channelName}" nije uspio, pokušavam još jednom za ${PUBLISH_RETRY_DELAY_MS}ms:`, err instanceof Error ? err.message : err);
    await new Promise(r => setTimeout(r, PUBLISH_RETRY_DELAY_MS));
    // Ako i OVAJ pokušaj padne, greška se propagira pozivaocu (koji je
    // već obučen da je uhvati preko .catch() i osloni se na fallback
    // polling/reconciliation — vidi opširan komentar tamo).
    await channel.publish(eventName, data);
  }
}