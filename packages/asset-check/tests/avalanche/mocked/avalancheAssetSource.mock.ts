import { vi } from 'vitest';

/** Creates an inert qualified balance source for one explicitly selected network. */
export const createQualifiedSource = (chainId: 43113 | 43114) => {
  return {
    expectedChainId: BigInt(chainId),
    assertNetwork: vi.fn(async () => {}),
    getAddressBalanceForNativeToken: vi.fn(async () => 101n),
  };
};
