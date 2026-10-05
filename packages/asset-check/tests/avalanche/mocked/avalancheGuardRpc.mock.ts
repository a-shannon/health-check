import { vi } from 'vitest';

/** Creates a canonical finalized block and synthetic RPC responses. */
export const createGuardRpcMock = () => {
  const address = '0x' + '12'.repeat(20);
  const block = {
    number: 12,
    hash: '0x' + 'ab'.repeat(32),
    parentHash: '0x' + 'cd'.repeat(32),
  };
  const rpc = {
    getBlock: vi.fn(async () => block),
    send: vi.fn(async (method: string): Promise<unknown> => {
      if (method === 'eth_chainId') return '0xa869';
      if (method === 'eth_getBalance') return '0x65';
      if (method === 'eth_getBlockByNumber')
        return { number: '0xc', hash: block.hash };
      throw new Error('Unexpected RPC method');
    }),
  };

  return { address, block, rpc };
};
