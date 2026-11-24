import { DataTypes } from 'sequelize';

export async function up({ context: queryInterface }) {
  await queryInterface.createTable('platform_settings', {
    key: { type: DataTypes.STRING(64), primaryKey: true },
    value: { type: DataTypes.JSON, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
}

export async function down({ context: queryInterface }) {
  await queryInterface.dropTable('platform_settings');
}
