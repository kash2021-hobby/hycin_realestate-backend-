import { DataTypes } from 'sequelize';

const key = () => ({ type: DataTypes.CHAR(36), primaryKey: true });
const stamp = () => ({ type: DataTypes.DATE, allowNull: false });
const tenantId = () => ({ type: DataTypes.CHAR(36), allowNull: false });

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
  await queryInterface.createTable('properties', {
    id: key(),
    tenant_id: tenantId(),
    name: { type: DataTypes.STRING(160), allowNull: false },
    slug: { type: DataTypes.STRING(80), allowNull: false },
    developer: { type: DataTypes.STRING(160) },
    location: { type: DataTypes.STRING(160) },
    type_label: { type: DataTypes.STRING(80) },
    size_range: { type: DataTypes.STRING(80) },
    price_from: { type: DataTypes.STRING(40) },
    possession: { type: DataTypes.STRING(80) },
    status: { type: DataTypes.ENUM('draft', 'live', 'archived'), allowNull: false, defaultValue: 'draft' },
    stage_label: { type: DataTypes.STRING(80) },
    rera_or_hoa: { type: DataTypes.STRING(80) },
    amenities: { type: DataTypes.JSON },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await foreignKey(queryInterface, 'properties', 'tenant_id', 'tenants');
  await queryInterface.addIndex('properties', ['tenant_id', 'slug'], { unique: true, name: 'properties_tenant_slug' });
  await queryInterface.addIndex('properties', ['tenant_id', 'status'], { name: 'properties_tenant_status' });

  await queryInterface.createTable('leads', {
    id: key(),
    tenant_id: tenantId(),
    name: { type: DataTypes.STRING(160), allowNull: false },
    phone: { type: DataTypes.STRING(32) },
    email: { type: DataTypes.STRING(255) },
    source: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'manual' },
    source_detail: { type: DataTypes.STRING(160) },
    property_id: { type: DataTypes.CHAR(36) },
    budget: { type: DataTypes.STRING(80) },
    need: { type: DataTypes.STRING(160) },
    stage: { type: DataTypes.ENUM('new', 'talking', 'visit', 'visited', 'negotiation', 'won', 'lost'), allowNull: false, defaultValue: 'new' },
    priority: { type: DataTypes.ENUM('low', 'normal', 'high'), allowNull: false, defaultValue: 'normal' },
    score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    preferred_channel: { type: DataTypes.STRING(32) },
    owner_user_id: { type: DataTypes.CHAR(36) },
    follow_up_at: { type: DataTypes.DATE },
    last_activity_at: { type: DataTypes.DATE, allowNull: false },
    archived_at: { type: DataTypes.DATE },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await foreignKey(queryInterface, 'leads', 'tenant_id', 'tenants');
  await foreignKey(queryInterface, 'leads', 'property_id', 'properties', 'SET NULL');
  await foreignKey(queryInterface, 'leads', 'owner_user_id', 'users', 'SET NULL');
  await queryInterface.addIndex('leads', ['tenant_id', 'phone'], { name: 'leads_tenant_phone' });
  await queryInterface.addIndex('leads', ['tenant_id', 'email'], { name: 'leads_tenant_email' });
  await queryInterface.addIndex('leads', ['tenant_id', 'stage'], { name: 'leads_tenant_stage' });
  await queryInterface.addIndex('leads', ['tenant_id', 'last_activity_at'], { name: 'leads_tenant_activity' });

  await queryInterface.createTable('timeline_events', {
    id: key(),
    tenant_id: tenantId(),
    lead_id: { type: DataTypes.CHAR(36), allowNull: false },
    type: { type: DataTypes.STRING(40), allowNull: false },
    summary: { type: DataTypes.STRING(500), allowNull: false },
    actor_user_id: { type: DataTypes.CHAR(36) },
    created_at: stamp(),
  });
  await foreignKey(queryInterface, 'timeline_events', 'tenant_id', 'tenants');
  await foreignKey(queryInterface, 'timeline_events', 'lead_id', 'leads', 'CASCADE');
  await queryInterface.addIndex('timeline_events', ['tenant_id', 'lead_id', 'created_at'], { name: 'timeline_lead' });

  await queryInterface.createTable('visits', {
    id: key(),
    tenant_id: tenantId(),
    lead_id: { type: DataTypes.CHAR(36), allowNull: false },
    property_id: { type: DataTypes.CHAR(36) },
    start_at: { type: DataTypes.DATE, allowNull: false },
    end_at: { type: DataTypes.DATE },
    type: { type: DataTypes.ENUM('site', 'video', 'phone'), allowNull: false, defaultValue: 'site' },
    source: { type: DataTypes.ENUM('agent', 'public_site'), allowNull: false, defaultValue: 'agent' },
    status: { type: DataTypes.ENUM('booked', 'visited', 'no_show', 'rescheduled', 'cancelled'), allowNull: false, defaultValue: 'booked' },
    notes: { type: DataTypes.STRING(500) },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await foreignKey(queryInterface, 'visits', 'tenant_id', 'tenants');
  await foreignKey(queryInterface, 'visits', 'lead_id', 'leads');
  await foreignKey(queryInterface, 'visits', 'property_id', 'properties', 'SET NULL');
  await queryInterface.addIndex('visits', ['tenant_id', 'start_at'], { name: 'visits_tenant_start' });
}

export async function down({ context: queryInterface }) {
  await queryInterface.dropTable('visits');
  await queryInterface.dropTable('timeline_events');
  await queryInterface.dropTable('leads');
  await queryInterface.dropTable('properties');
}
