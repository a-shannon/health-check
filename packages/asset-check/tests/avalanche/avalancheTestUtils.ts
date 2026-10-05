import {
  AvalancheAssetHealthConfig,
  AvalancheRpcAssetHealthCheckParam,
} from '../../lib/avalanche';
import { createQualifiedSource } from './mocked/avalancheAssetSource.mock';

/** Creates a real health parameter over an independent synthetic qualified source. */
export const setup = (chainId: 43113 | 43114 = 43113) => {
  const config: AvalancheAssetHealthConfig = {
    chainId,
    sourceId: 'synthetic-rpc',
    address: '0x' + '12'.repeat(20),
    warnThreshold: 100n,
    criticalThreshold: 10n,
  };
  const source = createQualifiedSource(chainId);
  const health = new AvalancheRpcAssetHealthCheckParam(config, source);
  return { config, source, health };
};

/** A controllable asynchronous result for latest-attempt ownership fixtures. */
export const deferred = () => {
  let resolve!: (value: bigint) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<bigint>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
};
