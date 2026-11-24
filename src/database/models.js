import { DataTypes } from 'sequelize';

export function defineModels(sequelize) {
  const Tenant = sequelize.define('tenants', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    name: { type: DataTypes.STRING(160), allowNull: false },
    slug: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    status: { type: DataTypes.ENUM('active', 'suspended'), allowNull: false, defaultValue: 'active' },
    market: { type: DataTypes.ENUM('IN', 'US'), allowNull: false, defaultValue: 'IN' },
    brand: { type: DataTypes.STRING(160) },
    phone: { type: DataTypes.STRING(32) },
    onboardingStep: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'O2' },
    planKey: { type: DataTypes.STRING(32) },
    alertChatId: { type: DataTypes.STRING(32) },
    replyPolicy: { type: DataTypes.JSON },
  });

  const User = sequelize.define('users', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    phone: { type: DataTypes.STRING(32) },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    name: { type: DataTypes.STRING(160), allowNull: false },
    isSuperAdmin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  });

  const Membership = sequelize.define('memberships', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    userId: { type: DataTypes.CHAR(36), allowNull: false },
    role: { type: DataTypes.ENUM('tenant_admin', 'manager', 'agent', 'viewer'), allowNull: false },
  }, {
    indexes: [{ unique: true, fields: ['tenant_id', 'user_id'] }],
  });

  const RefreshToken = sequelize.define('refresh_tokens', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    userId: { type: DataTypes.CHAR(36), allowNull: false },
    tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    revokedAt: { type: DataTypes.DATE },
  }, { updatedAt: false });

  const AuditLog = sequelize.define('audit_logs', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    actorUserId: { type: DataTypes.CHAR(36) },
    tenantId: { type: DataTypes.CHAR(36) },
    action: { type: DataTypes.STRING(80), allowNull: false },
    targetType: { type: DataTypes.STRING(80) },
    targetId: { type: DataTypes.STRING(64) },
    metadata: { type: DataTypes.JSON },
  }, { updatedAt: false });

  Tenant.hasMany(Membership, { foreignKey: 'tenantId' });
  User.hasMany(Membership, { foreignKey: 'userId' });
  Membership.belongsTo(Tenant, { foreignKey: 'tenantId' });
  Membership.belongsTo(User, { foreignKey: 'userId' });
  User.hasMany(RefreshToken, { foreignKey: 'userId' });

  const PlatformSetting = sequelize.define('platform_settings', {
    key: { type: DataTypes.STRING(64), primaryKey: true },
    value: { type: DataTypes.JSON, allowNull: false },
  }, { createdAt: false });

  const Property = sequelize.define('properties', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    name: { type: DataTypes.STRING(160), allowNull: false },
    slug: { type: DataTypes.STRING(80), allowNull: false },
    developer: { type: DataTypes.STRING(160) },
    location: { type: DataTypes.STRING(160) },
    typeLabel: { type: DataTypes.STRING(80) },
    sizeRange: { type: DataTypes.STRING(80) },
    priceFrom: { type: DataTypes.STRING(40) },
    possession: { type: DataTypes.STRING(80) },
    status: { type: DataTypes.ENUM('draft', 'live', 'archived'), allowNull: false, defaultValue: 'draft' },
    stageLabel: { type: DataTypes.STRING(80) },
    reraOrHoa: { type: DataTypes.STRING(80) },
    amenities: { type: DataTypes.JSON },
  });

  const Lead = sequelize.define('leads', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    name: { type: DataTypes.STRING(160), allowNull: false },
    phone: { type: DataTypes.STRING(32) },
    email: { type: DataTypes.STRING(255) },
    source: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'manual' },
    sourceDetail: { type: DataTypes.STRING(160) },
    propertyId: { type: DataTypes.CHAR(36) },
    budget: { type: DataTypes.STRING(80) },
    need: { type: DataTypes.STRING(160) },
    stage: { type: DataTypes.ENUM('new', 'talking', 'visit', 'visited', 'negotiation', 'won', 'lost'), allowNull: false, defaultValue: 'new' },
    priority: { type: DataTypes.ENUM('low', 'normal', 'high'), allowNull: false, defaultValue: 'normal' },
    score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    preferredChannel: { type: DataTypes.STRING(32) },
    ownerUserId: { type: DataTypes.CHAR(36) },
    followUpAt: { type: DataTypes.DATE },
    lastActivityAt: { type: DataTypes.DATE, allowNull: false },
    archivedAt: { type: DataTypes.DATE },
  });

  const TimelineEvent = sequelize.define('timeline_events', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    leadId: { type: DataTypes.CHAR(36), allowNull: false },
    type: { type: DataTypes.STRING(40), allowNull: false },
    summary: { type: DataTypes.STRING(500), allowNull: false },
    actorUserId: { type: DataTypes.CHAR(36) },
  }, { updatedAt: false });

  const Visit = sequelize.define('visits', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    leadId: { type: DataTypes.CHAR(36), allowNull: false },
    propertyId: { type: DataTypes.CHAR(36) },
    startAt: { type: DataTypes.DATE, allowNull: false },
    endAt: { type: DataTypes.DATE },
    type: { type: DataTypes.ENUM('site', 'video', 'phone'), allowNull: false, defaultValue: 'site' },
    source: { type: DataTypes.ENUM('agent', 'public_site'), allowNull: false, defaultValue: 'agent' },
    status: { type: DataTypes.ENUM('booked', 'visited', 'no_show', 'rescheduled', 'cancelled'), allowNull: false, defaultValue: 'booked' },
    notes: { type: DataTypes.STRING(500) },
  });

  Property.hasMany(Lead, { foreignKey: 'propertyId' });
  Lead.belongsTo(Property, { foreignKey: 'propertyId' });
  User.hasMany(Lead, { foreignKey: 'ownerUserId', as: 'ownedLeads' });
  Lead.belongsTo(User, { foreignKey: 'ownerUserId', as: 'Owner' });
  Lead.hasMany(TimelineEvent, { foreignKey: 'leadId' });
  Lead.hasMany(Visit, { foreignKey: 'leadId' });
  Visit.belongsTo(Lead, { foreignKey: 'leadId' });
  Visit.belongsTo(Property, { foreignKey: 'propertyId' });

  const Site = sequelize.define('sites', {
    tenantId: { type: DataTypes.CHAR(36), primaryKey: true },
    themeKey: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'forest' },
    headline: { type: DataTypes.STRING(240) },
    tagline: { type: DataTypes.STRING(500) },
    about: { type: DataTypes.TEXT },
    languages: { type: DataTypes.JSON },
    licenceNo: { type: DataTypes.STRING(80) },
    yearsLabel: { type: DataTypes.STRING(40) },
    areas: { type: DataTypes.JSON },
    whatsapp: { type: DataTypes.STRING(32) },
    reviewQuote: { type: DataTypes.STRING(500) },
    reviewAuthor: { type: DataTypes.STRING(160) },
    reviewRating: { type: DataTypes.STRING(16) },
    reviewCount: { type: DataTypes.INTEGER },
    sections: { type: DataTypes.JSON },
    customDomain: { type: DataTypes.STRING(255), unique: true },
    domainStatus: { type: DataTypes.ENUM('none', 'pending'), allowNull: false, defaultValue: 'none' },
    seoTitle: { type: DataTypes.STRING(160) },
    seoDescription: { type: DataTypes.STRING(300) },
    publishedAt: { type: DataTypes.DATE },
  });

  const SiteEvent = sequelize.define('site_events', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    propertyId: { type: DataTypes.CHAR(36) },
    sessionId: { type: DataTypes.STRING(64), allowNull: false },
    type: { type: DataTypes.STRING(40), allowNull: false },
    path: { type: DataTypes.STRING(255) },
    referrer: { type: DataTypes.STRING(500) },
    utmSource: { type: DataTypes.STRING(80) },
    ipHash: { type: DataTypes.CHAR(64) },
    payload: { type: DataTypes.JSON },
  }, { updatedAt: false });

  Tenant.hasOne(Site, { foreignKey: 'tenantId' });
  Site.belongsTo(Tenant, { foreignKey: 'tenantId' });

  const SheetIntegration = sequelize.define('sheet_integrations', {
    tenantId: { type: DataTypes.CHAR(36), primaryKey: true },
    spreadsheetId: { type: DataTypes.STRING(128), allowNull: false },
    spreadsheetTitle: { type: DataTypes.STRING(200) },
    tabName: { type: DataTypes.STRING(120), allowNull: false },
    status: { type: DataTypes.ENUM('connected', 'error', 'off'), allowNull: false, defaultValue: 'connected' },
    lastError: { type: DataTypes.STRING(500) },
    headers: { type: DataTypes.JSON },
    connectedAt: { type: DataTypes.DATE },
    lastPolledAt: { type: DataTypes.DATE },
  });

  const SheetSyncEvent = sequelize.define('sheet_sync_events', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    leadId: { type: DataTypes.CHAR(36), allowNull: false },
    spreadsheetId: { type: DataTypes.STRING(128), allowNull: false },
    direction: { type: DataTypes.ENUM('outbound', 'inbound'), allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'synced', 'failed'), allowNull: false, defaultValue: 'pending' },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastError: { type: DataTypes.STRING(500) },
  });

  Tenant.hasOne(SheetIntegration, { foreignKey: 'tenantId' });
  SheetIntegration.belongsTo(Tenant, { foreignKey: 'tenantId' });
  Lead.hasMany(SheetSyncEvent, { foreignKey: 'leadId' });
  SheetSyncEvent.belongsTo(Lead, { foreignKey: 'leadId' });

  const ChannelConnection = sequelize.define('channel_connections', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    platform: { type: DataTypes.ENUM('instagram', 'facebook', 'whatsapp', 'youtube', 'google', 'telegram'), allowNull: false },
    status: { type: DataTypes.ENUM('off', 'connecting', 'on', 'error', 'ltab_requested', 'ltab_in_progress'), allowNull: false, defaultValue: 'off' },
    displayName: { type: DataTypes.STRING(200) },
    externalAccountId: { type: DataTypes.STRING(128) },
    scopes: { type: DataTypes.JSON },
    tokenCiphertext: { type: DataTypes.TEXT },
    lastError: { type: DataTypes.STRING(500) },
    lastCheckedAt: { type: DataTypes.DATE },
  });

  const Thread = sequelize.define('threads', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    leadId: { type: DataTypes.CHAR(36) },
    platform: { type: DataTypes.ENUM('instagram', 'facebook', 'whatsapp', 'youtube', 'google', 'telegram'), allowNull: false },
    kind: { type: DataTypes.ENUM('dm', 'comment', 'review'), allowNull: false },
    externalThreadId: { type: DataTypes.STRING(191), allowNull: false },
    status: { type: DataTypes.ENUM('new', 'queued', 'replied', 'booked', 'handoff', 'agent_replied'), allowNull: false, defaultValue: 'new' },
    contactName: { type: DataTypes.STRING(160), allowNull: false },
    preview: { type: DataTypes.STRING(500) },
    aiPaused: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    assigneeUserId: { type: DataTypes.CHAR(36) },
    queuedPostAt: { type: DataTypes.DATE },
    handoffReason: { type: DataTypes.STRING(300) },
    lastActivityAt: { type: DataTypes.DATE, allowNull: false },
    metaAssetId: { type: DataTypes.CHAR(36) },
    externalContactId: { type: DataTypes.STRING(191) },
    unreadCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  });

  const Message = sequelize.define('messages', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    threadId: { type: DataTypes.CHAR(36), allowNull: false },
    direction: { type: DataTypes.ENUM('in', 'out'), allowNull: false },
    author: { type: DataTypes.ENUM('customer', 'ai', 'agent'), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    externalId: { type: DataTypes.STRING(191) },
    delivery: { type: DataTypes.ENUM('stored', 'sent', 'failed', 'not_delivered'), allowNull: false },
    messageType: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'text' },
    attachmentMetadata: { type: DataTypes.JSON },
    sentAt: { type: DataTypes.DATE },
    deliveredAt: { type: DataTypes.DATE },
    readAt: { type: DataTypes.DATE },
    errorCode: { type: DataTypes.STRING(80) },
    errorMessage: { type: DataTypes.STRING(500) },
    createdAt: { type: DataTypes.DATE(3), allowNull: false },
  }, { updatedAt: false });

  const WebhookEvent = sequelize.define('webhook_events', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    provider: { type: DataTypes.STRING(40), allowNull: false },
    externalEventId: { type: DataTypes.STRING(191), allowNull: false },
    tenantId: { type: DataTypes.CHAR(36) },
    payload: { type: DataTypes.JSON },
    eventType: { type: DataTypes.STRING(80) },
    status: { type: DataTypes.ENUM('pending', 'processing', 'processed', 'failed'), allowNull: false, defaultValue: 'pending' },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    processedAt: { type: DataTypes.DATE },
    lastError: { type: DataTypes.STRING(500) },
  });

  const MetaConnection = sequelize.define('meta_connections', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    provider: { type: DataTypes.ENUM('facebook', 'instagram', 'whatsapp'), allowNull: false },
    connectionStatus: { type: DataTypes.ENUM('not_connected', 'connecting', 'connected', 'needs_reauth', 'permission_missing', 'error', 'disconnected'), allowNull: false, defaultValue: 'not_connected' },
    metaBusinessId: { type: DataTypes.STRING(64) },
    metaUserId: { type: DataTypes.STRING(64) },
    grantedPermissions: { type: DataTypes.JSON },
    tokenCiphertext: { type: DataTypes.TEXT },
    tokenExpiresAt: { type: DataTypes.DATE },
    lastValidatedAt: { type: DataTypes.DATE },
    lastErrorCode: { type: DataTypes.STRING(80) },
    lastErrorMessage: { type: DataTypes.STRING(500) },
    connectedByUserId: { type: DataTypes.CHAR(36) },
    channelConnectionId: { type: DataTypes.CHAR(36) },
  });

  const MetaAsset = sequelize.define('meta_assets', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    metaConnectionId: { type: DataTypes.CHAR(36), allowNull: false },
    assetType: { type: DataTypes.ENUM('facebook_page', 'instagram_account', 'whatsapp_business_account', 'whatsapp_phone_number'), allowNull: false },
    externalAssetId: { type: DataTypes.STRING(64), allowNull: false },
    parentExternalAssetId: { type: DataTypes.STRING(64) },
    displayName: { type: DataTypes.STRING(200) },
    username: { type: DataTypes.STRING(160) },
    phoneNumber: { type: DataTypes.STRING(32) },
    metadataJson: { type: DataTypes.JSON },
    status: { type: DataTypes.ENUM('active', 'disabled', 'error'), allowNull: false, defaultValue: 'active' },
  });

  const SocialComment = sequelize.define('social_comments', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    metaAssetId: { type: DataTypes.CHAR(36) },
    externalCommentId: { type: DataTypes.STRING(191), allowNull: false },
    externalPostId: { type: DataTypes.STRING(191) },
    externalMediaId: { type: DataTypes.STRING(191) },
    authorExternalId: { type: DataTypes.STRING(64) },
    authorName: { type: DataTypes.STRING(160) },
    body: { type: DataTypes.TEXT },
    parentCommentId: { type: DataTypes.STRING(191) },
    replyStatus: { type: DataTypes.ENUM('not_sent', 'pending', 'replied', 'failed'), allowNull: false, defaultValue: 'not_sent' },
    replyError: { type: DataTypes.STRING(500) },
  });

  const MetaOnboardingState = sequelize.define('meta_onboarding_states', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    userId: { type: DataTypes.CHAR(36), allowNull: false },
    provider: { type: DataTypes.ENUM('facebook', 'instagram', 'whatsapp'), allowNull: false },
    stateHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    usedAt: { type: DataTypes.DATE },
  }, { updatedAt: false });

  Tenant.hasMany(MetaConnection, { foreignKey: 'tenantId' });
  MetaConnection.belongsTo(Tenant, { foreignKey: 'tenantId' });
  MetaConnection.hasMany(MetaAsset, { foreignKey: 'metaConnectionId' });
  MetaAsset.belongsTo(MetaConnection, { foreignKey: 'metaConnectionId' });
  MetaAsset.belongsTo(Tenant, { foreignKey: 'tenantId' });
  Thread.belongsTo(MetaAsset, { foreignKey: 'metaAssetId' });

  const Notification = sequelize.define('notifications', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenantId: { type: DataTypes.CHAR(36), allowNull: false },
    type: { type: DataTypes.STRING(40), allowNull: false },
    title: { type: DataTypes.STRING(160), allowNull: false },
    body: { type: DataTypes.STRING(500) },
    deepLink: { type: DataTypes.STRING(255) },
    readAt: { type: DataTypes.DATE },
  }, { updatedAt: false });

  return {
    Tenant, User, Membership, RefreshToken, AuditLog, PlatformSetting, Property, Lead, TimelineEvent, Visit, Site, SiteEvent,
    SheetIntegration, SheetSyncEvent, ChannelConnection, Thread, Message, WebhookEvent, Notification,
    MetaConnection, MetaAsset, SocialComment, MetaOnboardingState,
  };
}
