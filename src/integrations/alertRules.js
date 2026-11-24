export const DEFAULT_POLICY = {
  comments: false,
  dms: false,
  reviews: true,
  book: true,
  away: true,
  link: false,
  price: true,
  complaint: true,
  delayMin: 3,
  bot: 'disabled',
};

export function normalizePolicy(input = {}) {
  const delay = Number(input.delayMin ?? input.delay ?? DEFAULT_POLICY.delayMin);
  return {
    comments: Boolean(input.comments),
    dms: Boolean(input.dms),
    reviews: input.reviews !== false,
    book: input.book !== false,
    away: input.away !== false,
    link: Boolean(input.link),
    price: input.price !== false,
    complaint: input.complaint !== false && input.comp !== false,
    delayMin: Number.isFinite(delay) ? Math.min(30, Math.max(0, Math.round(delay))) : 3,
    bot: 'disabled',
  };
}

export function shouldEnqueueAlert(chatId) {
  return /^-?\d{1,20}$/.test(String(chatId || '').trim());
}

export function alertText(notification) {
  const title = String(notification?.title || 'HYCIN').slice(0, 160);
  const body = String(notification?.body || '').slice(0, 300);
  return body ? `${title}\n${body}` : title;
}

export async function sendTelegramAlert({ token, chatId, text, fetchImpl = fetch }) {
  if (!shouldEnqueueAlert(chatId)) return { sent: false, reason: 'unset' };
  if (!token) return { sent: false, reason: 'not_configured' };
  let response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (error) {
    const failure = new Error('Telegram did not accept the alert.');
    failure.cause = error;
    throw failure;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error('Telegram did not accept the alert.');
  return { sent: true };
}
