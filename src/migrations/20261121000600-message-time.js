import { DataTypes } from 'sequelize';

export async function up({ context: queryInterface }) {
  await queryInterface.changeColumn('messages', 'created_at', { type: DataTypes.DATE(3), allowNull: false });
}

export async function down({ context: queryInterface }) {
  await queryInterface.changeColumn('messages', 'created_at', { type: DataTypes.DATE, allowNull: false });
}
