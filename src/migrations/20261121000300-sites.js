import { DataTypes } from 'sequelize';

const stamp = () => ({ type: DataTypes.DATE, allowNull: false });

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
  await queryInterface.createTable('sites', {
    tenant_id: { type: DataTypes.CHAR(36), primaryKey: true },
    theme_key: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'forest' },
    headline: { type: DataTypes.STRING(240) },
    tagline: { type: DataTypes.STRING(500) },
    about: { type: DataTypes.TEXT },
    languages: { type: DataTypes.JSON },
    licence_no: { type: DataTypes.STRING(80) },
    years_label: { type: DataTypes.STRING(40) },
    areas: { type: DataTypes.JSON },
    whatsapp: { type: DataTypes.STRING(32) },
    review_quote: { type: DataTypes.STRING(500) },
    review_author: { type: DataTypes.STRING(160) },
    review_rating: { type: DataTypes.STRING(16) },
    review_count: { type: DataTypes.INTEGER },
    sections: { type: DataTypes.JSON },
    custom_domain: { type: DataTypes.STRING(255) },
    domain_status: { type: DataTypes.ENUM('none', 'pending'), allowNull: false, defaultValue: 'none' },
    seo_title: { type: DataTypes.STRING(160) },
    seo_description: { type: DataTypes.STRING(300) },
    published_at: { type: DataTypes.DATE },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await foreignKey(queryInterface, 'sites', 'tenant_id', 'tenants', 'CASCADE');
  await queryInterface.addIndex('sites', ['custom_domain'], { unique: true, name: 'sites_custom_domain' });

  await queryInterface.createTable('site_events', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenant_id: { type: DataTypes.CHAR(36), allowNull: false },
    property_id: { type: DataTypes.CHAR(36) },
    session_id: { type: DataTypes.STRING(64), allowNull: false },
    type: { type: DataTypes.STRING(40), allowNull: false },
    path: { type: DataTypes.STRING(255) },
    referrer: { type: DataTypes.STRING(500) },
    utm_source: { type: DataTypes.STRING(80) },
    ip_hash: { type: DataTypes.CHAR(64) },
    payload: { type: DataTypes.JSON },
    created_at: stamp(),
  });
  await foreignKey(queryInterface, 'site_events', 'tenant_id', 'tenants', 'CASCADE');
  await foreignKey(queryInterface, 'site_events', 'property_id', 'properties', 'SET NULL');
  await queryInterface.addIndex('site_events', ['tenant_id', 'created_at'], { name: 'site_events_tenant_created' });
  await queryInterface.addIndex('site_events', ['tenant_id', 'type'], { name: 'site_events_tenant_type' });
}

export async function down({ context: queryInterface }) {
  await queryInterface.dropTable('site_events');
  await queryInterface.dropTable('sites');
}
