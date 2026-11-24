import { DataTypes } from 'sequelize';

export async function up({ context: queryInterface }) {
  await queryInterface.addColumn('tenants', 'alert_chat_id', { type: DataTypes.STRING(32), allowNull: true });
  await queryInterface.addColumn('tenants', 'reply_policy', { type: DataTypes.JSON, allowNull: true });
}

export async function down({ context: queryInterface }) {
  await queryInterface.removeColumn('tenants', 'reply_policy');
  await queryInterface.removeColumn('tenants', 'alert_chat_id');
}
