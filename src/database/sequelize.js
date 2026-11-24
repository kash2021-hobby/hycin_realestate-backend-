import { Sequelize } from 'sequelize';

export function createSequelize(env) {
  return new Sequelize(env.mysql.database, env.mysql.user, env.mysql.password, {
    host: env.mysql.host,
    port: env.mysql.port,
    dialect: 'mysql',
    logging: env.nodeEnv === 'development' ? (sql) => console.log(sql) : false,
    define: {
      underscored: true,
      freezeTableName: true,
    },
  });
}
