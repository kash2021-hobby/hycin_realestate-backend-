const VERSION = /^v\d+\.\d+$/;

export function graphVersion(meta) {
  const version = String(meta?.graphVersion || 'v21.0').trim();
  return VERSION.test(version) ? version : 'v21.0';
}

export function graphBase(meta) {
  return `https://graph.facebook.com/${graphVersion(meta)}`;
}

export function facebookDialog(meta) {
  return `https://www.facebook.com/${graphVersion(meta)}/dialog/oauth`;
}

export function publicMetaConfig(meta = {}) {
  return {
    appId: meta.appId || null,
    graphVersion: graphVersion(meta),
    embeddedSignupConfigId: meta.embeddedSignupConfigId || null,
    redirectUri: meta.redirectUri || null,
    onboarding: 'not_available',
    products: {
      messenger: 'not_available',
      facebookComments: 'not_available',
      instagramMessages: 'not_available',
      instagramComments: 'not_available',
      whatsapp: 'not_available',
    },
  };
}

export function adminMetaStatus(meta = {}) {
  return {
    ...publicMetaConfig(meta),
    readiness: {
      appId: Boolean(meta.appId),
      appSecret: Boolean(meta.appSecret),
      webhookVerifyToken: Boolean(meta.verifyToken),
      tokenEncryptionKey: Boolean(meta.tokenEncryptionKey),
      embeddedSignupConfigId: Boolean(meta.embeddedSignupConfigId),
      redirectUri: Boolean(meta.redirectUri),
    },
    appReview: {
      status: 'not_confirmed',
      note: 'HYCIN has not confirmed Meta App Review or which permissions this app is approved to use.',
    },
  };
}

export function presentMetaConnection(row) {
  return {
    id: row.id,
    provider: row.provider,
    connectionStatus: row.connectionStatus,
    metaBusinessId: row.metaBusinessId || null,
    metaUserId: row.metaUserId || null,
    grantedPermissions: row.grantedPermissions || [],
    tokenExpiresAt: row.tokenExpiresAt || null,
    lastValidatedAt: row.lastValidatedAt || null,
    lastErrorCode: row.lastErrorCode || null,
    lastErrorMessage: row.lastErrorMessage || null,
    connectedByUserId: row.connectedByUserId || null,
  };
}

export function presentMetaAsset(row) {
  return {
    id: row.id,
    metaConnectionId: row.metaConnectionId,
    assetType: row.assetType,
    externalAssetId: row.externalAssetId,
    parentExternalAssetId: row.parentExternalAssetId || null,
    displayName: row.displayName || null,
    username: row.username || null,
    phoneNumber: row.phoneNumber || null,
    status: row.status,
  };
}
