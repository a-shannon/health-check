import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthStatusLevel } from '@rosen-bridge/health-check';

import { ZCASH_NATIVE_ASSET } from '../../lib/constants';
import { TestZcashRpcAssetHealthCheck } from './testZcash';

const mockClient = {
  post: vi.fn(),
};

vi.mock('@rosen-clients/rate-limited-axios', () => ({
  default: {
    create: () => mockClient,
  },
}));

const createCheck = () =>
  new TestZcashRpcAssetHealthCheck(
    ZCASH_NATIVE_ASSET,
    't1example',
    1_000_000n,
    100_000n,
    'http://127.0.0.1:8232',
  );

const mockBalance = (balance: unknown) => {
  mockClient.post.mockImplementationOnce(
    async (_url: string, body?: unknown) => {
      const { id } = body as { id: string };
      return {
        data: {
          jsonrpc: '2.0',
          id,
          result: { balance },
          error: null,
        },
      };
    },
  );
};

describe('ZcashRpcAssetHealthCheckParam', () => {
  beforeEach(() => {
    mockClient.post.mockReset();
  });

  it('updates the ZEC amount from an exact zatoshi integer', async () => {
    const check = createCheck();
    mockBalance(2_100_000_000_000_000);

    await check.update();

    expect(check.getTokenAmount()).toBe(2_100_000_000_000_000n);
    expect(check.getHealthStatus()).toBe(HealthStatusLevel.HEALTHY);
    expect(check.getLastTrialErrorMessage()).toBeUndefined();
  });

  it('accepts an exact decimal zatoshi string', async () => {
    const check = createCheck();
    mockClient.post.mockImplementationOnce(
      async (_url: string, body?: unknown) => {
        const { id } = body as { id: string };
        return {
          data: {
            id,
            result: { balance: '1000000' },
            error: null,
          },
        };
      },
    );

    await check.update();

    expect(check.getTokenAmount()).toBe(1_000_000n);
    expect(check.getHealthStatus()).toBe(HealthStatusLevel.HEALTHY);
  });

  it('invalidates a healthy observation on RPC error and recovers after a valid response', async () => {
    const check = createCheck();
    mockBalance(1_000_000);
    await check.update();
    mockClient.post.mockImplementationOnce(
      async (_url: string, body?: unknown) => {
        const { id } = body as { id: string };
        return {
          data: {
            jsonrpc: '2.0',
            id,
            error: { code: -1, message: 'private node detail' },
          },
        };
      },
    );

    await check.update();

    expect(check.getTokenAmount()).toBe(0n);
    expect(check.getHealthStatus()).toBe(HealthStatusLevel.BROKEN);
    expect(check.getLastTrialErrorMessage()).toBe(
      'Zcash asset balance RPC request failed',
    );

    mockBalance(2_000_000);
    await check.update();

    expect(check.getTokenAmount()).toBe(2_000_000n);
    expect(check.getHealthStatus()).toBe(HealthStatusLevel.HEALTHY);
    expect(check.getLastTrialErrorMessage()).toBeUndefined();
  });

  it('rejects a valid balance returned with the wrong RPC id', async () => {
    const check = createCheck();
    mockClient.post.mockResolvedValueOnce({
      data: {
        jsonrpc: '2.0',
        id: 'wrong-id',
        result: { balance: 1_000_000 },
        error: null,
      },
    });

    await check.update();

    expect(check.getTokenAmount()).toBe(0n);
    expect(check.getHealthStatus()).toBe(HealthStatusLevel.BROKEN);
    expect(check.getLastTrialErrorMessage()).toBe(
      'Zcash asset balance RPC request failed',
    );
  });

  it.each([1.5, Number.NaN, -1, '-1', '1.0', 2_100_000_000_000_001])(
    'rejects an inexact or out-of-range zatoshi balance %s',
    async (balance) => {
      const check = createCheck();
      mockBalance(balance);

      await check.update();

      expect(check.getTokenAmount()).toBe(0n);
      expect(check.getHealthStatus()).toBe(HealthStatusLevel.BROKEN);
      expect(check.getLastTrialErrorMessage()).toBe(
        'Zcash asset balance RPC request failed',
      );
    },
  );

  it('rejects disabled or inverted positive thresholds', () => {
    expect(
      () =>
        new TestZcashRpcAssetHealthCheck(
          ZCASH_NATIVE_ASSET,
          't1example',
          100n,
          0n,
          'http://127.0.0.1:8232',
        ),
    ).toThrow('Invalid Zcash asset health thresholds');
    expect(
      () =>
        new TestZcashRpcAssetHealthCheck(
          ZCASH_NATIVE_ASSET,
          't1example',
          10n,
          100n,
          'http://127.0.0.1:8232',
        ),
    ).toThrow('Invalid Zcash asset health thresholds');
  });
});
