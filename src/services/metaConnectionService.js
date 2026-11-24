import { presentMetaAsset, presentMetaConnection } from '../integrations/metaConfig.js';

export function createMetaConnectionService({ models }) {
  const { MetaConnection, MetaAsset } = models;

  return {
    async workspace(tenantId) {
      const connections = await MetaConnection.findAll({ where: { tenantId }, order: [['provider', 'ASC']] });
      const assets = await MetaAsset.findAll({ where: { tenantId }, order: [['assetType', 'ASC'], ['displayName', 'ASC']] });
      return {
        connections: connections.map(presentMetaConnection),
        assets: assets.map(presentMetaAsset),
      };
    },
  };
}
