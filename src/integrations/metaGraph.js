import { facebookDialog, graphBase } from './metaConfig.js';

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

export async function graphRequest(fetchImpl, token, url, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { ...options, headers });
  const body = await readJson(response);
  if (!response.ok) {
    throw fail(400, 'meta_rejected', body.error?.message || 'Meta refused the request.');
  }
  return body;
}

export function metaLoginUrl({ meta, redirectUri, state, platform }) {
  if (!meta?.appId) throw fail(503, 'not_configured', 'META_APP_ID is not set.');
  if (platform === 'whatsapp' && !meta.embeddedSignupConfigId) {
    throw fail(503, 'not_configured', 'META_EMBEDDED_SIGNUP_CONFIG_ID is required before WhatsApp can be connected.');
  }
  const url = new URL(facebookDialog(meta));
  url.searchParams.set('client_id', meta.appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  if (meta.embeddedSignupConfigId) {
    url.searchParams.set('config_id', meta.embeddedSignupConfigId);
    url.searchParams.set('override_default_response_type', 'true');
    return url.toString();
  }
  url.searchParams.set('scope', [
    'pages_show_list',
    'pages_messaging',
    'pages_manage_metadata',
    'pages_read_engagement',
    'instagram_basic',
    'instagram_manage_messages',
    'instagram_manage_comments',
    'business_management',
  ].join(','));
  return url.toString();
}

export async function exchangeMetaCode(fetchImpl, meta, redirectUri, code) {
  const url = new URL(`${graphBase(meta)}/oauth/access_token`);
  url.searchParams.set('client_id', meta.appId);
  url.searchParams.set('client_secret', meta.appSecret);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code', code);
  const tokenBody = await graphRequest(fetchImpl, '', url);
  if (!tokenBody.access_token) throw fail(400, 'oauth_rejected', 'Meta did not return a token.');
  const longUrl = new URL(`${graphBase(meta)}/oauth/access_token`);
  longUrl.searchParams.set('grant_type', 'fb_exchange_token');
  longUrl.searchParams.set('client_id', meta.appId);
  longUrl.searchParams.set('client_secret', meta.appSecret);
  longUrl.searchParams.set('fb_exchange_token', tokenBody.access_token);
  const longBody = await graphRequest(fetchImpl, '', longUrl).catch(() => tokenBody);
  return {
    token: longBody.access_token || tokenBody.access_token,
    expiresIn: Number(longBody.expires_in || tokenBody.expires_in || 0),
  };
}

async function collect(fetchImpl, token, firstUrl) {
  const rows = [];
  let url = firstUrl;
  for (let page = 0; page < 5 && url; page += 1) {
    const body = await graphRequest(fetchImpl, token, url);
    rows.push(...(body.data || []));
    url = body.paging?.next || '';
  }
  return rows;
}

export async function discoverMetaAssets(fetchImpl, meta, token) {
  const base = graphBase(meta);
  const me = await graphRequest(fetchImpl, token, `${base}/me?fields=id,name`);
  const pages = await collect(fetchImpl, token, `${base}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}`).catch(() => []);
  const businesses = await collect(fetchImpl, token, `${base}/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}},client_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}`).catch(() => []);
  const phones = [];
  for (const business of businesses) {
    const accounts = [
      ...(business.owned_whatsapp_business_accounts?.data || []),
      ...(business.client_whatsapp_business_accounts?.data || []),
    ];
    for (const account of accounts) {
      for (const phone of account.phone_numbers?.data || []) {
        phones.push({
          wabaId: String(account.id),
          wabaName: account.name || 'WhatsApp',
          phoneNumberId: String(phone.id),
          display: phone.display_phone_number || phone.verified_name || 'WhatsApp',
        });
      }
    }
  }
  return {
    userId: me.id ? String(me.id) : null,
    userName: me.name || 'Meta',
    pages: pages.filter((page) => page.id).map((page) => ({
      id: String(page.id),
      name: page.name || 'Facebook Page',
      accessToken: page.access_token || token,
      instagram: page.instagram_business_account?.id ? {
        id: String(page.instagram_business_account.id),
        name: page.instagram_business_account.name || page.instagram_business_account.username || 'Instagram',
        username: page.instagram_business_account.username || null,
      } : null,
    })),
    phones,
  };
}

export function assetsForPlatform(discovered, platform) {
  if (platform === 'facebook') {
    return discovered.pages.map((page) => ({
      assetType: 'facebook_page',
      externalAssetId: page.id,
      displayName: page.name,
      token: page.accessToken,
    }));
  }
  if (platform === 'instagram') {
    return discovered.pages.filter((page) => page.instagram).map((page) => ({
      assetType: 'instagram_account',
      externalAssetId: page.instagram.id,
      parentExternalAssetId: page.id,
      displayName: page.instagram.name,
      username: page.instagram.username,
      token: page.accessToken,
    }));
  }
  return discovered.phones.map((phone) => ({
    assetType: 'whatsapp_phone_number',
    externalAssetId: phone.phoneNumberId,
    parentExternalAssetId: phone.wabaId,
    displayName: phone.display,
    phoneNumber: phone.display,
    token: null,
    wabaId: phone.wabaId,
    wabaName: phone.wabaName,
  }));
}

export async function subscribeAsset(fetchImpl, meta, asset, token) {
  const base = graphBase(meta);
  if (asset.assetType === 'whatsapp_phone_number') {
    await graphRequest(fetchImpl, token, `${base}/${asset.parentExternalAssetId}/subscribed_apps`, { method: 'POST', body: '{}' });
    return;
  }
  const fields = asset.assetType === 'instagram_account' ? 'messages,comments' : 'messages,feed,message_echoes';
  await graphRequest(fetchImpl, asset.token || token, `${base}/${asset.externalAssetId}/subscribed_apps`, {
    method: 'POST',
    body: JSON.stringify({ subscribed_fields: fields }),
  });
}

export async function sendChannelMessage(fetchImpl, meta, asset, token, target) {
  const base = graphBase(meta);
  if (asset.assetType === 'whatsapp_phone_number') {
    const body = await graphRequest(fetchImpl, token, `${base}/${asset.externalAssetId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: target.contactId,
        type: 'text',
        text: { body: target.text },
      }),
    });
    const id = body.messages?.[0]?.id;
    if (!id) throw fail(502, 'meta_rejected', 'WhatsApp did not return a message id.');
    return { id: `wa:${id}` };
  }
  if (target.kind === 'comment') {
    const commentId = String(target.externalId || '').replace(/^meta:/, '');
    const body = await graphRequest(fetchImpl, asset.token || token, `${base}/${commentId}/replies`, {
      method: 'POST',
      body: JSON.stringify({ message: target.text }),
    });
    if (!body.id) throw fail(502, 'meta_rejected', 'Meta did not return a comment reply id.');
    return { id: `meta:${body.id}` };
  }
  const body = await graphRequest(fetchImpl, asset.token || token, `${base}/${asset.externalAssetId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ recipient: { id: target.contactId }, message: { text: target.text } }),
  });
  const id = body.message_id || body.id;
  if (!id) throw fail(502, 'meta_rejected', 'Meta did not return a message id.');
  return { id: `meta:${id}` };
}

export function parseMetaWebhook(payload) {
  const events = [];
  for (const entry of payload?.entry || []) {
    const accountId = entry?.id ? String(entry.id) : '';
    for (const event of entry.messaging || []) {
      if (event?.message?.is_echo) continue;
      const mid = event?.message?.mid;
      if (!mid || !event?.sender?.id) continue;
      events.push({
        type: 'message',
        accountId,
        contactId: String(event.sender.id),
        contactName: 'Meta contact',
        externalMessageId: `meta:${mid}`,
        body: event.message.text ? String(event.message.text) : '[attachment]',
        kind: 'dm',
      });
    }
    for (const change of entry.changes || []) {
      const value = change?.value || {};
      if (value.messaging_product === 'whatsapp' || change.field === 'messages') {
        const phoneNumberId = String(value.metadata?.phone_number_id || accountId || '');
        for (const message of value.messages || []) {
          if (!message.id || !message.from) continue;
          const contact = (value.contacts || []).find((item) => item.wa_id === message.from);
          events.push({
            type: 'message',
            platform: 'whatsapp',
            accountId: phoneNumberId,
            contactId: String(message.from),
            contactName: contact?.profile?.name || 'WhatsApp',
            externalMessageId: `wa:${message.id}`,
            body: message.text?.body ? String(message.text.body) : `[${message.type || 'message'}]`,
            kind: 'dm',
          });
        }
        for (const status of value.statuses || []) {
          if (!status.id) continue;
          events.push({
            type: 'status',
            accountId: phoneNumberId,
            externalMessageId: `wa:${status.id}`,
            status: status.status,
            error: status.errors?.[0]?.title || status.errors?.[0]?.message || null,
          });
        }
        continue;
      }
      const commentId = value.comment_id || ((change.field === 'comments' || change.field === 'feed') ? value.id : null);
      const text = value.message || value.text;
      if (!commentId || !text) continue;
      events.push({
        type: 'comment',
        accountId,
        contactId: value.from?.id ? String(value.from.id) : '',
        contactName: value.from?.name || value.from?.username || 'Comment',
        externalMessageId: `meta:${commentId}`,
        externalCommentId: String(commentId),
        externalPostId: value.post_id || value.media?.id || null,
        body: String(text),
        kind: 'comment',
        parentId: value.parent_id || null,
      });
    }
  }
  return events;
}
