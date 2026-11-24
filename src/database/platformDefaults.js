export const PLATFORM_KEYS = ['fees', 'packages', 'services', 'plans', 'credits', 'themes'];

export const platformDefaults = {
  fees: {
    mode: 'pct',
    pct: 15,
    markets: {
      IN: { flat: 1500, minFee: 1000 },
      US: { flat: 150, minFee: 100 },
    },
    applies: { all: true, override: true, show: true, tax: true },
  },
  packages: {
    items: [
      { k: 'a5', n: 'Launch', spendIN: '₹5,000', spendUS: '$500', reach: '18k – 30k people', leads: '15 – 30 leads', pop: false, visible: true },
      { k: 'a10', n: 'Grow', spendIN: '₹10,000', spendUS: '$1,000', reach: '40k – 65k people', leads: '35 – 60 leads', pop: true, visible: true },
      { k: 'a15', n: 'Dominate', spendIN: '₹15,000', spendUS: '$1,500', reach: '60k – 95k people', leads: '55 – 90 leads', pop: false, visible: true },
      { k: 'custom', n: 'Custom', spendIN: 'Up to ₹1,00,000+', spendUS: 'Up to $10,000+', reach: 'Planned with you', leads: 'Planned with you', pop: false, visible: true },
    ],
    customMinIN: 20000,
    customMaxIN: 200000,
    customMinUS: 2000,
    customMaxUS: 20000,
    channels: ['meta', 'google', 'youtube'],
  },
  services: {
    items: [
      { k: 'ads', n: 'Run ads for me', d: 'Meta + Google lead ads, managed by LTAB', price: 'Service fee', unit: '—', turnaround: '24h to live', active: true },
      { k: 'video', n: 'AI property video', d: '30–45s reel from your brochure and photos', price: '₹2,499', unit: 'video', turnaround: '48–72h', active: true },
      { k: 'creative', n: 'Ad creatives', d: '6 static posts + 3 stories, on-brand', price: '₹1,499', unit: 'set', turnaround: '48–72h', active: true },
      { k: 'shoot', n: 'Walkthrough edit', d: 'Send your phone footage, we cut it', price: '₹1,999', unit: 'video', turnaround: '48–72h', active: true },
    ],
    samples: [
      { n: 'Launch reel', on: true },
      { n: 'Walkthrough', on: true },
      { n: 'Price reveal', on: true },
      { n: 'Amenities tour', on: false },
    ],
  },
  plans: {
    items: [
      { k: 'starter', n: 'Starter', priceIN: '₹1,499', priceUS: '$19', credits: 500, trialDays: 14, listings: '5', seats: '1', features: { site: true, inbox: true, ai: true, links: false, booking: false, crm: false, followups: false, domain: false, voice: false } },
      { k: 'pro', n: 'Pro', priceIN: '₹3,999', priceUS: '$49', credits: 2000, trialDays: 14, listings: '∞', seats: '1', features: { site: true, inbox: true, ai: true, links: true, booking: true, crm: true, followups: true, domain: false, voice: false } },
      { k: 'elite', n: 'Elite', priceIN: '₹8,999', priceUS: '$99', credits: 5000, trialDays: 14, listings: '∞', seats: '3', features: { site: true, inbox: true, ai: true, links: true, booking: true, crm: true, followups: true, domain: true, voice: true } },
    ],
    topups: [
      { credits: '500 credits', priceIN: '₹699', priceUS: '$9' },
      { credits: '2,000 credits', priceIN: '₹2,299', priceUS: '$29' },
      { credits: '5,000 credits', priceIN: '₹4,999', priceUS: '$59' },
    ],
  },
  credits: {
    costs: [
      { action: 'AI reply (comment or DM)', credits: 1, key: 'ai_reply' },
      { action: 'Property share link (tracked)', credits: 5, key: 'share_link' },
      { action: 'AI follow-up draft', credits: 1, key: 'followup_draft' },
      { action: 'Appointment booked by AI', credits: 2, key: 'ai_booking' },
      { action: 'Brochure read → listing', credits: 10, key: 'brochure_extract' },
      { action: 'WhatsApp agent conversation', credits: 3, key: 'wa_conversation' },
    ],
    stopAi: true,
    overdraft: true,
    alerts: true,
  },
  themes: {
    items: [
      { k: 'forest', n: 'Forest', bg: '#1E2A24', fg: '#F4EFE6', ac: '#C9B78F', font: 'Georgia, serif', on: true },
      { k: 'ink', n: 'Ink', bg: '#121212', fg: '#FFFFFF', ac: '#FF6A00', font: 'Bricolage Grotesque, sans-serif', on: true },
      { k: 'harbour', n: 'Harbour', bg: '#14233B', fg: '#EEF2F7', ac: '#7FB2E5', font: 'Manrope, sans-serif', on: true },
      { k: 'sand', n: 'Sand', bg: '#EFE6D8', fg: '#2B241B', ac: '#A0522D', font: 'Georgia, serif', on: true },
    ],
  },
};
