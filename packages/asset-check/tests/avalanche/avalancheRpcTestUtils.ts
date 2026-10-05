import { AvalancheRpcNetwork } from '@rosen-chains/avalanche-rpc';

import { AvalancheRpcAssetHealthCheckParam } from '../../lib/avalanche';
import { createGuardRpcMock } from './mocked/avalancheGuardRpc.mock';

/** Joins a real qualified Guard RPC adapter to actual shared asset health. */
export const setup = () => {
  const { address, block, rpc } = createGuardRpcMock();
  const network = new AvalancheRpcNetwork(
    'http://127.0.0.1:1',
    { getRepository: () => ({}) } as unknown as ConstructorParameters<
      typeof AvalancheRpcNetwork
    >[1],
    address,
    43113n,
    'synthetic-health',
    1000,
  );
  Object.defineProperty(network, 'provider', { value: rpc });
  const health = new AvalancheRpcAssetHealthCheckParam(
    {
      chainId: 43113,
      sourceId: 'synthetic-health',
      address,
      warnThreshold: 100n,
      criticalThreshold: 10n,
    },
    network,
  );
  return { health, rpc, block, address };
};
