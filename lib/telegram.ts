// lib/telegram.ts
//
// Slanje poruke na Telegram (obavještenja o problemima sistema). Bez ikakvih zavisnosti — jedan HTTPS poziv.
// Podešavanje (Vercel → Environment Variables): TELEGRAM_BOT_TOKEN (od @BotFather) i TELEGRAM_CHAT_ID (lični ili grupni chat).
// Ako nisu postavljeni, slanje se tiho preskače (funkcija vraća false) — ništa drugo u sistemu ne zavisi od Telegrama.
// Token se NIKAD ne upisuje u log (ni u poruke grešaka).

export interface TelegramConfig { token: string; chatId: string }

export function getTelegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig | null {
  const token = (env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatId = (env.TELEGRAM_CHAT_ID ?? '').trim();
  return token && chatId ? { token, chatId } : null;
}

const MAX_LEN = 3900; // Telegram limit je 4096 znakova

export async function sendTelegram(
  text: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Promise<boolean> {
  const cfg = getTelegramConfig(opts.env);
  if (!cfg) return false;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4000);
  try {
    const res = await doFetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text: text.length > MAX_LEN ? text.slice(0, MAX_LEN - 1) + '…' : text,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) console.error(`[telegram] slanje nije uspjelo: HTTP ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error('[telegram] slanje nije uspjelo:', err instanceof Error ? err.name : 'greška');
    return false;
  } finally {
    clearTimeout(timer);
  }
}
