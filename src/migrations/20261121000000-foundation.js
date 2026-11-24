import { DataTypes } from 'sequelize';

const stamp = () => ({ type: DataTypes.DATE, allowNull: false });
const key = () => ({ type: DataTypes.CHAR(36), primaryKey: true });
const ref = (model) => ({
  type: DataTypes.CHAR(36),
  allowNull: false,
  references: { model, key: 'id' },
  onDelete: 'CASCADE',
});

export async function up({ context: queryInterface }) {
  await queryInterface.createTable('tenants', {
    id: key(),
    name: { type: DataTypes.STRING(160), allowNull: false },
    slug: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    status: { type: DataTypes.ENUM('active', 'suspended'), allowNull: false, defaultValue: 'active' },
    market: { type: DataTypes.ENUM('IN', 'US'), allowNull: false, defaultValue: 'IN' },
    brand: { type: DataTypes.STRING(160) },
    phone: { type: DataTypes.STRING(32) },
    onboarding_step: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'O2' },
    plan_key: { type: DataTypes.STRING(32) },
    created_at: stamp(),
    updated_at: stamp(),
  });

  await queryInterface.createTable('users', {
    id: key(),
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    phone: { type: DataTypes.STRING(32) },
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
    name: { type: DataTypes.STRING(160), allowNull: false },
    is_super_admin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: stamp(),
    updated_at: stamp(),
  });

  await queryInterface.createTable('memberships', {
    id: key(),
    tenant_id: ref('tenants'),
    user_id: ref('users'),
    role: { type: DataTypes.ENUM('tenant_admin', 'manager', 'agent', 'viewer'), allowNull: false },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await queryInterface.addIndex('memberships', ['tenant_id', 'user_id'], { unique: true, name: 'memberships_tenant_user' });
  await queryInterface.addIndex('memberships', ['tenant_id'], { name: 'memberships_tenant' });

  await queryInterface.createTable('refresh_tokens', {
    id: key(),
    user_id: ref('users'),
    token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    revoked_at: { type: DataTypes.DATE },
    created_at: stamp(),
  });

  await queryInterface.createTable('audit_logs', {
    id: key(),
    actor_user_id: { type: DataTypes.CHAR(36) },
    tenant_id: { type: DataTypes.CHAR(36) },
    action: { type: DataTypes.STRING(80), allowNull: false },
    target_type: { type: DataTypes.STRING(80) },
    target_id: { type: DataTypes.STRING(64) },
    metadata: { type: DataTypes.JSON },
    created_at: stamp(),
  });
  await queryInterface.addIndex('audit_logs', ['tenant_id', 'created_at'], { name: 'audit_logs_tenant_created' });
}

export async function down({ context: queryInterface }) {
  await queryInterface.dropTable('audit_logs');
  await queryInterface.dropTable('refresh_tokens');
  await queryInterface.dropTable('memberships');
  await queryInterface.dropTable('users');
  await queryInterface.dropTable('tenants');
}
