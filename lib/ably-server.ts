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

export async function publishToChannel(channelName: string, eventName: string, data: unknown): Promise<void> {
  const client = getAblyRest();
  const channel = client.channels.get(channelName);
  await channel.publish(eventName, data);
}