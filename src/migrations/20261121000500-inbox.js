import { DataTypes } from 'sequelize';

const stamp = () => ({ type: DataTypes.DATE, allowNull: false });
const platform = DataTypes.ENUM('instagram', 'facebook', 'whatsapp', 'youtube', 'google', 'telegram');
const connectionStatus = DataTypes.ENUM('off', 'connecting', 'on', 'error', 'ltab_requested', 'ltab_in_progress');

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
  await queryInterface.createTable('channel_connections', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenant_id: { type: DataTypes.CHAR(36), allowNull: false },
    platform: { type: platform, allowNull: false },
    status: { type: connectionStatus, allowNull: false, defaultValue: 'off' },
    display_name: { type: DataTypes.STRING(200) },
    external_account_id: { type: DataTypes.STRING(128) },
    scopes: { type: DataTypes.JSON },
    token_ciphertext: { type: DataTypes.TEXT },
    last_error: { type: DataTypes.STRING(500) },
    last_checked_at: { type: DataTypes.DATE },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await foreignKey(queryInterface, 'channel_connections', 'tenant_id', 'tenants', 'CASCADE');
  await queryInterface.addIndex('channel_connections', ['tenant_id', 'platform'], { unique: true, name: 'channel_one_per_platform' });

  await queryInterface.createTable('threads', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenant_id: { type: DataTypes.CHAR(36), allowNull: false },
    lead_id: { type: DataTypes.CHAR(36) },
    platform: { type: platform, allowNull: false },
    kind: { type: DataTypes.ENUM('dm', 'comment', 'review'), allowNull: false },
    external_thread_id: { type: DataTypes.STRING(191), allowNull: false },
    status: { type: DataTypes.ENUM('new', 'queued', 'replied', 'booked', 'handoff', 'agent_replied'), allowNull: false, defaultValue: 'new' },
    contact_name: { type: DataTypes.STRING(160), allowNull: false },
    preview: { type: DataTypes.STRING(500) },
    ai_paused: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    assignee_user_id: { type: DataTypes.CHAR(36) },
    queued_post_at: { type: DataTypes.DATE },
    handoff_reason: { type: DataTypes.STRING(300) },
    last_activity_at: { type: DataTypes.DATE, allowNull: false },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await foreignKey(queryInterface, 'threads', 'tenant_id', 'tenants', 'CASCADE');
  await foreignKey(queryInterface, 'threads', 'lead_id', 'leads', 'SET NULL');
  await foreignKey(queryInterface, 'threads', 'assignee_user_id', 'users', 'SET NULL');
  await queryInterface.addIndex('threads', ['tenant_id', 'platform', 'external_thread_id'], { unique: true, name: 'threads_external' });
  await queryInterface.addIndex('threads', ['tenant_id', 'last_activity_at'], { name: 'threads_tenant_activity' });

  await queryInterface.createTable('messages', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenant_id: { type: DataTypes.CHAR(36), allowNull: false },
    thread_id: { type: DataTypes.CHAR(36), allowNull: false },
    direction: { type: DataTypes.ENUM('in', 'out'), allowNull: false },
    author: { type: DataTypes.ENUM('customer', 'ai', 'agent'), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    external_id: { type: DataTypes.STRING(191) },
    delivery: { type: DataTypes.ENUM('stored', 'sent', 'failed', 'not_delivered'), allowNull: false },
    created_at: stamp(),
  });
  await foreignKey(queryInterface, 'messages', 'tenant_id', 'tenants', 'CASCADE');
  await foreignKey(queryInterface, 'messages', 'thread_id', 'threads', 'CASCADE');
  await queryInterface.addIndex('messages', ['tenant_id', 'external_id'], { unique: true, name: 'messages_external' });
  await queryInterface.addIndex('messages', ['thread_id', 'created_at'], { name: 'messages_thread_created' });

  await queryInterface.createTable('webhook_events', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    provider: { type: DataTypes.STRING(40), allowNull: false },
    external_event_id: { type: DataTypes.STRING(191), allowNull: false },
    tenant_id: { type: DataTypes.CHAR(36) },
    payload: { type: DataTypes.JSON },
    status: { type: DataTypes.ENUM('pending', 'processing', 'processed', 'failed'), allowNull: false, defaultValue: 'pending' },
    last_error: { type: DataTypes.STRING(500) },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await foreignKey(queryInterface, 'webhook_events', 'tenant_id', 'tenants', 'SET NULL');
  await queryInterface.addIndex('webhook_events', ['provider', 'external_event_id'], { unique: true, name: 'webhook_event_once' });

  await queryInterface.createTable('notifications', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenant_id: { type: DataTypes.CHAR(36), allowNull: false },
    type: { type: DataTypes.STRING(40), allowNull: false },
    title: { type: DataTypes.STRING(160), allowNull: false },
    body: { type: DataTypes.STRING(500) },
    deep_link: { type: DataTypes.STRING(255) },
    read_at: { type: DataTypes.DATE },
    created_at: stamp(),
  });
  await foreignKey(queryInterface, 'notifications', 'tenant_id', 'tenants', 'CASCADE');
  await queryInterface.addIndex('notifications', ['tenant_id', 'created_at'], { name: 'notifications_tenant_created' });
}

export async function down({ context: queryInterface }) {
  await queryInterface.dropTable('notifications');
  await queryInterface.dropTable('webhook_events');
  await queryInterface.dropTable('messages');
  await queryInterface.dropTable('threads');
  await queryInterface.dropTable('channel_connections');
}
