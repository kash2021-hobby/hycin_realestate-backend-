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
  await queryInterface.createTable('sheet_integrations', {
    tenant_id: { type: DataTypes.CHAR(36), primaryKey: true },
    spreadsheet_id: { type: DataTypes.STRING(128), allowNull: false },
    spreadsheet_title: { type: DataTypes.STRING(200) },
    tab_name: { type: DataTypes.STRING(120), allowNull: false },
    status: { type: DataTypes.ENUM('connected', 'error', 'off'), allowNull: false, defaultValue: 'connected' },
    last_error: { type: DataTypes.STRING(500) },
    headers: { type: DataTypes.JSON },
    connected_at: { type: DataTypes.DATE },
    last_polled_at: { type: DataTypes.DATE },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await foreignKey(queryInterface, 'sheet_integrations', 'tenant_id', 'tenants', 'CASCADE');

  await queryInterface.createTable('sheet_sync_events', {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    tenant_id: { type: DataTypes.CHAR(36), allowNull: false },
    lead_id: { type: DataTypes.CHAR(36), allowNull: false },
    spreadsheet_id: { type: DataTypes.STRING(128), allowNull: false },
    direction: { type: DataTypes.ENUM('outbound', 'inbound'), allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'synced', 'failed'), allowNull: false, defaultValue: 'pending' },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    last_error: { type: DataTypes.STRING(500) },
    created_at: stamp(),
    updated_at: stamp(),
  });
  await foreignKey(queryInterface, 'sheet_sync_events', 'tenant_id', 'tenants', 'CASCADE');
  await foreignKey(queryInterface, 'sheet_sync_events', 'lead_id', 'leads', 'CASCADE');
  await queryInterface.addIndex('sheet_sync_events', ['tenant_id', 'lead_id', 'spreadsheet_id'], { unique: true, name: 'sheet_sync_once' });
  await queryInterface.addIndex('sheet_sync_events', ['tenant_id', 'created_at'], { name: 'sheet_sync_tenant_created' });
}

export async function down({ context: queryInterface }) {
  await queryInterface.dropTable('sheet_sync_events');
  await queryInterface.dropTable('sheet_integrations');
}
