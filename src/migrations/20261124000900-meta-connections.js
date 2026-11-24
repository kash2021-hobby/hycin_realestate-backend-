import { DataTypes } from 'sequelize';

const stamp = () => ({ type: DataTypes.DATE, allowNull: false });
const provider = DataTypes.ENUM('facebook', 'instagram', 'whatsapp');

async function foreignKey(queryInterface, table, column, refTable, onDelete = 'RESTRICT') {
  await queryInterface.addConstraint(table, {
    fields: [column],
    type: 'foreign key',
    name: `${table}_${column}_fk`,
    references: { table: refTable, field: 'id' },
    onDelete,
  });
}

export async function up({ context: queryInterface }) {
  await queryInterface.createTable('meta_connections', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenant_id: { type: DataTypes.CHAR(36), allowNull: false },
    provider: { type: provider, allowNull: false },
    connection_status: { type: DataTypes.ENUM('not_connected', 'connecting', 'connected', 'needs_reauth', 'permission_missing', 'error', 'disconnected'), allowNull: false, defaultValue: 'not_connected' },
    meta_business_id: { type: DataTypes.STRING(64) },
    meta_user_id: { type: DataTypes.STRING(64) },
    granted_permissions: { type: DataTypes.JSON },
    token_ciphertext: { type: DataTypes.TEXT },
    token_expires_at: { type: DataTypes.DATE },
    last_validated_at: { type: DataTypes.DATE },
    last_error_code: { type: DataTypes.STRING(80) },
    last_error_message: { type: DataTypes.STRING(500) },
    connected_by_user_id: { type: DataTypes.CHAR(36) },
    channel_connection_id: { type: DataTypes.CHAR(36) },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await foreignKey(queryInterface, 'meta_connections', 'tenant_id', 'tenants', 'CASCADE');
  await foreignKey(queryInterface, 'meta_connections', 'connected_by_user_id', 'users', 'SET NULL');
  await foreignKey(queryInterface, 'meta_connections', 'channel_connection_id', 'channel_connections', 'SET NULL');
  await queryInterface.addIndex('meta_connections', ['tenant_id', 'provider'], { unique: true, name: 'meta_connection_provider' });

  await queryInterface.createTable('meta_assets', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenant_id: { type: DataTypes.CHAR(36), allowNull: false },
    meta_connection_id: { type: DataTypes.CHAR(36), allowNull: false },
    asset_type: { type: DataTypes.ENUM('facebook_page', 'instagram_account', 'whatsapp_business_account', 'whatsapp_phone_number'), allowNull: false },
    external_asset_id: { type: DataTypes.STRING(64), allowNull: false },
    parent_external_asset_id: { type: DataTypes.STRING(64) },
    display_name: { type: DataTypes.STRING(200) },
    username: { type: DataTypes.STRING(160) },
    phone_number: { type: DataTypes.STRING(32) },
    metadata_json: { type: DataTypes.JSON },
    status: { type: DataTypes.ENUM('active', 'disabled', 'error'), allowNull: false, defaultValue: 'active' },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await foreignKey(queryInterface, 'meta_assets', 'tenant_id', 'tenants', 'CASCADE');
  await foreignKey(queryInterface, 'meta_assets', 'meta_connection_id', 'meta_connections', 'CASCADE');
  await queryInterface.addIndex('meta_assets', ['asset_type', 'external_asset_id'], { unique: true, name: 'meta_asset_once' });
  await queryInterface.addIndex('meta_assets', ['tenant_id', 'asset_type'], { name: 'meta_assets_tenant_type' });

  await queryInterface.createTable('social_comments', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenant_id: { type: DataTypes.CHAR(36), allowNull: false },
    meta_asset_id: { type: DataTypes.CHAR(36) },
    external_comment_id: { type: DataTypes.STRING(191), allowNull: false },
    external_post_id: { type: DataTypes.STRING(191) },
    external_media_id: { type: DataTypes.STRING(191) },
    author_external_id: { type: DataTypes.STRING(64) },
    author_name: { type: DataTypes.STRING(160) },
    body: { type: DataTypes.TEXT },
    parent_comment_id: { type: DataTypes.STRING(191) },
    reply_status: { type: DataTypes.ENUM('not_sent', 'pending', 'replied', 'failed'), allowNull: false, defaultValue: 'not_sent' },
    reply_error: { type: DataTypes.STRING(500) },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await foreignKey(queryInterface, 'social_comments', 'tenant_id', 'tenants', 'CASCADE');
  await foreignKey(queryInterface, 'social_comments', 'meta_asset_id', 'meta_assets', 'SET NULL');
  await queryInterface.addIndex('social_comments', ['tenant_id', 'external_comment_id'], { unique: true, name: 'social_comment_once' });

  await queryInterface.createTable('meta_onboarding_states', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenant_id: { type: DataTypes.CHAR(36), allowNull: false },
    user_id: { type: DataTypes.CHAR(36), allowNull: false },
    provider: { type: provider, allowNull: false },
    state_hash: { type: DataTypes.CHAR(64), allowNull: false },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    used_at: { type: DataTypes.DATE },
    created_at: stamp(),
  });
  await foreignKey(queryInterface, 'meta_onboarding_states', 'tenant_id', 'tenants', 'CASCADE');
  await foreignKey(queryInterface, 'meta_onboarding_states', 'user_id', 'users', 'CASCADE');
  await queryInterface.addIndex('meta_onboarding_states', ['state_hash'], { unique: true, name: 'meta_onboarding_state_hash' });

  await queryInterface.addColumn('threads', 'meta_asset_id', { type: DataTypes.CHAR(36) });
  await queryInterface.addColumn('threads', 'external_contact_id', { type: DataTypes.STRING(191) });
  await queryInterface.addColumn('threads', 'unread_count', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await foreignKey(queryInterface, 'threads', 'meta_asset_id', 'meta_assets', 'SET NULL');
  await queryInterface.addIndex('threads', ['tenant_id', 'external_contact_id'], { name: 'threads_contact' });

  await queryInterface.addColumn('messages', 'message_type', { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'text' });
  await queryInterface.addColumn('messages', 'attachment_metadata', { type: DataTypes.JSON });
  await queryInterface.addColumn('messages', 'sent_at', { type: DataTypes.DATE });
  await queryInterface.addColumn('messages', 'delivered_at', { type: DataTypes.DATE });
  await queryInterface.addColumn('messages', 'read_at', { type: DataTypes.DATE });
  await queryInterface.addColumn('messages', 'error_code', { type: DataTypes.STRING(80) });
  await queryInterface.addColumn('messages', 'error_message', { type: DataTypes.STRING(500) });

  await queryInterface.addColumn('webhook_events', 'event_type', { type: DataTypes.STRING(80) });
  await queryInterface.addColumn('webhook_events', 'attempts', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await queryInterface.addColumn('webhook_events', 'processed_at', { type: DataTypes.DATE });
}

export async function down({ context: queryInterface }) {
  await queryInterface.removeColumn('webhook_events', 'processed_at');
  await queryInterface.removeColumn('webhook_events', 'attempts');
  await queryInterface.removeColumn('webhook_events', 'event_type');
  await queryInterface.removeColumn('messages', 'error_message');
  await queryInterface.removeColumn('messages', 'error_code');
  await queryInterface.removeColumn('messages', 'read_at');
  await queryInterface.removeColumn('messages', 'delivered_at');
  await queryInterface.removeColumn('messages', 'sent_at');
  await queryInterface.removeColumn('messages', 'attachment_metadata');
  await queryInterface.removeColumn('messages', 'message_type');
  await queryInterface.removeIndex('threads', 'threads_contact');
  await queryInterface.removeConstraint('threads', 'threads_meta_asset_id_fk');
  await queryInterface.removeColumn('threads', 'unread_count');
  await queryInterface.removeColumn('threads', 'external_contact_id');
  await queryInterface.removeColumn('threads', 'meta_asset_id');
  await queryInterface.dropTable('meta_onboarding_states');
  await queryInterface.dropTable('social_comments');
  await queryInterface.dropTable('meta_assets');
  await queryInterface.dropTable('meta_connections');
}
