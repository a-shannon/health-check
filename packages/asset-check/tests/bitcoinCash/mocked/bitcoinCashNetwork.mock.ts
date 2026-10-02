import { vi } from 'vitest';

import {
  BitcoinCashAssetNetwork,
  BitcoinCashAssets,
} from '../../../lib/bitcoinCash/types';

/**
 * create a fully mocked BCHN adapter with an exact native balance
 * @returns network double that never sends a request
 */
export const createBitcoinCashNetwork = (): BitcoinCashAssetNetwork => ({
  getAddressAssets: async () => ({ nativeToken: 100n, tokens: [] }),
});

/**
 * mock a balance lookup, including malformed payloads for admission tests
 * @param network BCHN adapter double
 * @param assets mocked native assets
 * @returns asset lookup spy
 */
export const mockBitcoinCashAssets = (
  network: BitcoinCashAssetNetwork,
  assets: unknown,
) =>
  vi
    .spyOn(network, 'getAddressAssets')
    .mockResolvedValue(assets as BitcoinCashAssets);

/**
 * mock a balance lookup failure without sending a request
 * @param network BCHN adapter double
 * @param error mocked rejection
 * @returns asset lookup spy
 */
export const mockBitcoinCashFailure = (
  network: BitcoinCashAssetNetwork,
  error: unknown,
) => vi.spyOn(network, 'getAddressAssets').mockRejectedValue(error);
