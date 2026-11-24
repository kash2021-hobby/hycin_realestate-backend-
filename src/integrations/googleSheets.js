import crypto from 'node:crypto';

export const SHEET_HEADERS = ['HYCIN lead id', 'Name', 'Phone', 'Email', 'Source', 'Property', 'Budget', 'Need', 'Stage', 'Created'];

const HEADER_FIELDS = [
  ['leadId', ['hycin lead id', 'lead id']],
  ['name', ['name', 'full_name', 'full name']],
  ['firstName', ['first_name', 'first name']],
  ['lastName', ['last_name', 'last name']],
  ['phone', ['phone', 'mobile', 'whatsapp', 'phone_number', 'phone number', 'mobile_number']],
  ['email', ['email', 'email_address', 'email address']],
  ['source', ['source']],
  ['property', ['property', 'project']],
  ['budget', ['budget']],
  ['need', ['need', 'requirement']],
  ['stage', ['stage']],
  ['created', ['created', 'created at', 'created_time', 'created time']],
];

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function describeServiceAccount(raw) {
  if (!raw || !String(raw).trim()) return { configured: false, email: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed.client_email && parsed.private_key) {
      return { configured: true, email: String(parsed.client_email), account: parsed };
    }
  } catch {
    return { configured: false, email: null };
  }
  return { configured: false, email: null };
}

export function publicSheetsStatus(raw) {
  const described = describeServiceAccount(raw);
  return { configured: described.configured, email: described.email };
}

export function spreadsheetIdFrom(value) {
  const text = String(value || '').trim();
  const fromUrl = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = fromUrl ? fromUrl[1] : text;
  if (!/^[a-zA-Z0-9-_]{20,}$/.test(id)) {
    throw fail(400, 'validation', 'Paste a Google Sheet link or the spreadsheet id.');
  }
  return id;
}

export function headerIndex(headers) {
  const normalized = (headers || []).map((cell) => String(cell || '').trim().toLowerCase());
  const index = {};
  for (const [field, names] of HEADER_FIELDS) {
    index[field] = normalized.findIndex((cell) => names.includes(cell));
  }
  return index;
}

export function classifySheetRows(rows, knownLeadIds) {
  if (!rows?.length) return { imported: [], skipped: 0 };
  const columns = headerIndex(rows[0]);
  if (columns.name < 0 && columns.phone < 0 && columns.firstName < 0) {
    return { imported: [], skipped: 0, error: 'The first row needs a Name or Phone column.' };
  }
  const imported = [];
  let skipped = 0;
  rows.slice(1).forEach((row, rowIndex) => {
    const leadId = columns.leadId >= 0 ? String(row[columns.leadId] || '').trim() : '';
    if (leadId && knownLeadIds.has(leadId)) {
      skipped += 1;
      return;
    }
    const named = columns.name >= 0 ? String(row[columns.name] || '').trim() : '';
    const first = columns.firstName >= 0 ? String(row[columns.firstName] || '').trim() : '';
    const last = columns.lastName >= 0 ? String(row[columns.lastName] || '').trim() : '';
    const name = named || [first, last].filter(Boolean).join(' ');
    const phone = columns.phone >= 0 ? String(row[columns.phone] || '').trim() : '';
    const email = columns.email >= 0 ? String(row[columns.email] || '').trim() : '';
    if (!name && !phone && !email) {
      skipped += 1;
      return;
    }
    imported.push({
      leadId,
      rowNumber: rowIndex + 2,
      name: name || 'Sheet lead',
      phone,
      email,
      source: columns.source >= 0 ? String(row[columns.source] || '').trim() : '',
      property: columns.property >= 0 ? String(row[columns.property] || '').trim() : '',
      budget: columns.budget >= 0 ? String(row[columns.budget] || '').trim() : '',
      need: columns.need >= 0 ? String(row[columns.need] || '').trim() : '',
    });
  });
  return { imported, skipped };
}

export function leadRow(headers, lead, propertyName) {
  const values = {
    'hycin lead id': lead.id,
    'lead id': lead.id,
    name: lead.name || '',
    full_name: lead.name || '',
    'full name': lead.name || '',
    phone: lead.phone || '',
    mobile: lead.phone || '',
    whatsapp: lead.phone || '',
    phone_number: lead.phone || '',
    'phone number': lead.phone || '',
    email: lead.email || '',
    email_address: lead.email || '',
    'email address': lead.email || '',
    source: lead.source || '',
    property: propertyName || '',
    project: propertyName || '',
    budget: lead.budget || '',
    need: lead.need || '',
    requirement: lead.need || '',
    stage: lead.stage || '',
    created: lead.createdAt ? new Date(lead.createdAt).toISOString() : '',
    'created at': lead.createdAt ? new Date(lead.createdAt).toISOString() : '',
  };
  return headers.map((header) => values[String(header).trim().toLowerCase()] ?? '');
}

async function accessToken(account, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  signer.end();
  const signature = signer.sign(account.private_key).toString('base64url');
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw fail(502, 'sheets_auth', 'Google did not accept the service account.');
  }
  return data.access_token;
}

function sheetsError(status, data) {
  if (status === 403 || status === 404) {
    return fail(400, 'sheets_denied', 'The service account cannot open that spreadsheet. Share it as an Editor, then try again.');
  }
  const message = String(data?.error?.message || 'Google Sheets refused the request.').slice(0, 240);
  return fail(502, 'sheets_error', message);
}

export function createGoogleSheets(raw, fetchImpl = fetch) {
  const described = describeServiceAccount(raw);
  let token = '';
  let tokenUntil = 0;

  async function bearer() {
    if (!described.configured) throw fail(503, 'sheets_unconfigured', 'Google Sheets is not configured on the server.');
    if (token && Date.now() < tokenUntil) return token;
    token = await accessToken(described.account, fetchImpl);
    tokenUntil = Date.now() + 50 * 60 * 1000;
    return token;
  }

  async function request(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options,
      headers: { authorization: `Bearer ${await bearer()}`, 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw sheetsError(response.status, data);
    return data;
  }

  return {
    status: { configured: described.configured, email: described.email },
    async open(spreadsheetId) {
      const data = await request(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties.title`);
      const tab = data.sheets?.[0]?.properties?.title;
      if (!tab) throw fail(400, 'sheets_denied', 'That spreadsheet has no tab to write to.');
      return { title: data.properties?.title || 'Spreadsheet', tab };
    },
    async values(spreadsheetId, tab) {
      const range = encodeURIComponent(`${tab}!A1:Z`);
      const data = await request(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`);
      return data.values || [];
    },
    async append(spreadsheetId, tab, rows) {
      const range = encodeURIComponent(`${tab}!A1`);
      return request(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: JSON.stringify({ values: rows }),
      });
    },
    async writeLeadId(spreadsheetId, tab, rowNumber, leadId) {
      const range = encodeURIComponent(`${tab}!A${rowNumber}`);
      return request(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        body: JSON.stringify({ values: [[leadId]] }),
      });
    },
  };
}
