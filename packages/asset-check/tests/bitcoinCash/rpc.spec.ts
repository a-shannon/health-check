import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthCheck, HealthStatusLevel } from '@rosen-bridge/health-check';

import { BitcoinCashRpcAssetHealthCheckParam } from '../../lib/bitcoinCash/rpc';
import {
  createBitcoinCashNetwork,
  mockBitcoinCashAssets,
  mockBitcoinCashFailure,
} from './mocked/bitcoinCashNetwork.mock';

/** Public synthetic CashAddr used only as an adapter lookup argument. */
const address = 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a';

describe('BitcoinCashRpcAssetHealthCheckParam', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    /**
     * @target BitcoinCashRpcAssetHealthCheckParam.constructor preserves the BCH asset identity and starts with an unknown balance
     * @dependencies
     * - mocked BCHN adapter
     * @scenario
     * - construct the native balance check without calling update
     * - inspect the asset identity and unknown balance state
     * @expected
     * - the BCH identity is stable and the balance starts broken and unavailable
     */
    it('preserves the BCH asset identity and starts with an unknown balance', () => {
      const param = new BitcoinCashRpcAssetHealthCheckParam(
        createBitcoinCashNetwork(),
        address,
        100n,
        50n,
      );
      expect(param.getId()).toEqual(`asset_bch_${address}`);
      expect(param.getTitle()).toEqual('[bitcoin-cash] Available BCH Balance');
      expect(param.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
      expect(param.getDescription()).toContain('unknown');
      expect(param.getDetails()).toContain('unavailable');
    });

    /**
     * @target BitcoinCashRpcAssetHealthCheckParam.constructor rejects malformed threshold policy %#
     * @dependencies
     * - mocked BCHN adapter
     * @scenario
     * - pass each invalid type, negative threshold, inverted policy and bound
     * @expected
     * - construction throws for each individually invalid policy
     */
    it.each([
      [-1n, 0n],
      [100n, -1n],
      [100n, 101n],
      [2_100_000_000_000_001n, 0n],
      [100, 50n],
      [100n, 50],
    ])('rejects malformed threshold policy %#', (warning, critical) => {
      expect(
        () =>
          new BitcoinCashRpcAssetHealthCheckParam(
            createBitcoinCashNetwork(),
            address,
            warning as bigint,
            critical as bigint,
          ),
      ).toThrow(Error);
    });
  });

  describe('update', () => {
    /**
     * @target BitcoinCashRpcAssetHealthCheckParam.update compares %s native satoshis exactly
     * @dependencies
     * - mocked BCHN adapter
     * - HealthCheck status and history consumer
     * @scenario
     * - return each boundary balance from the fully mocked adapter
     * - register the check and update it through HealthCheck
     * @expected
     * - exact native balances produce the matching status without rounding
     * - the validated address is passed once and no error is recorded
     */
    it.each([
      [0n, HealthStatusLevel.BROKEN],
      [49n, HealthStatusLevel.BROKEN],
      [50n, HealthStatusLevel.UNSTABLE],
      [99n, HealthStatusLevel.UNSTABLE],
      [100n, HealthStatusLevel.HEALTHY],
      [101n, HealthStatusLevel.HEALTHY],
      [2_100_000_000_000_000n, HealthStatusLevel.HEALTHY],
    ])('compares %s native satoshis exactly', async (amount, expected) => {
      const network = createBitcoinCashNetwork();
      const lookup = mockBitcoinCashAssets(network, {
        nativeToken: amount,
        tokens: [],
      });
      const param = new BitcoinCashRpcAssetHealthCheckParam(
        network,
        address,
        100n,
        50n,
      );
      const health = new HealthCheck();
      health.register(param);
      await health.updateParam(param.getId());
      expect(lookup).toHaveBeenCalledExactlyOnceWith(address);
      expect(param.getHealthStatus()).toEqual(expected);
      expect(param.getDescription()).toContain(`${amount} satoshis`);
      expect(param.getLastTrialErrorTime()).toBeUndefined();
      if (expected === HealthStatusLevel.HEALTHY)
        expect(param.getDetails()).toBeUndefined();
      else
        expect(param.getDetails()).toContain(
          expected === HealthStatusLevel.BROKEN ? 'critical' : 'warning',
        );
    });

    /**
     * @target BitcoinCashRpcAssetHealthCheckParam.update accepts equality at identical %s thresholds
     * @dependencies
     * - mocked BCHN adapter
     * @scenario
     * - use equal zero and positive warning and critical thresholds
     * - return a balance equal to both thresholds and update the check
     * @expected
     * - balance equality is healthy, including the zero policy
     */
    it.each([0n, 100n])(
      'accepts equality at identical %s thresholds',
      async (amount) => {
        const network = createBitcoinCashNetwork();
        mockBitcoinCashAssets(network, { nativeToken: amount, tokens: [] });
        const param = new BitcoinCashRpcAssetHealthCheckParam(
          network,
          address,
          amount,
          amount,
        );
        await param.update();
        expect(param.getHealthStatus()).toEqual(HealthStatusLevel.HEALTHY);
      },
    );

    /**
     * @target BitcoinCashRpcAssetHealthCheckParam.update invalidates healthy state on malformed assets %#
     * @dependencies
     * - mocked BCHN adapter
     * @scenario
     * - first update from a healthy native balance
     * - change only the response to each malformed native-asset payload
     * - update again
     * @expected
     * - invalid types, bounds and token-bearing results produce unknown balance
     * - the earlier healthy amount cannot survive the failure
     */
    it.each([
      { nativeToken: 100, tokens: [] },
      { nativeToken: '100', tokens: [] },
      { nativeToken: -1n, tokens: [] },
      { nativeToken: 2_100_000_000_000_001n, tokens: [] },
      { nativeToken: 100n, tokens: undefined },
      { nativeToken: 100n, tokens: [{ id: 'foreign', value: 1n }] },
      null,
      undefined,
    ])('invalidates healthy state on malformed assets %#', async (assets) => {
      const network = createBitcoinCashNetwork();
      const lookup = mockBitcoinCashAssets(network, {
        nativeToken: 100n,
        tokens: [],
      });
      const param = new BitcoinCashRpcAssetHealthCheckParam(
        network,
        address,
        100n,
        50n,
      );
      await param.update();
      expect(param.getHealthStatus()).toEqual(HealthStatusLevel.HEALTHY);
      lookup.mockResolvedValue(assets as never);
      await param.update();
      expect(param.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
      expect(param.getLastTrialErrorMessage()).toEqual(
        'BCH treasury balance update failed',
      );
      expect(param.getDescription()).toContain('unknown');
      expect(param.getDetails()).toContain('unavailable');
    });

    /**
     * @target BitcoinCashRpcAssetHealthCheckParam.update sanitizes adapter error form %# and recovers
     * @dependencies
     * - mocked BCHN adapter
     * - HealthCheck status consumer
     * @scenario
     * - update a registered parameter to a healthy balance
     * - reject its next lookup with credential-bearing data in each error form
     * - inspect the public status and then return a valid balance
     * @expected
     * - failure marks unknown native balance and exposes only the sanitized error
     * - a later successful update clears the failure state
     */
    it.each([
      Error(
        'identity mismatch: http://secret-user:secret-password@example.invalid',
      ),
      'secret-response',
      { password: 'secret-password' },
    ])('sanitizes adapter error form %# and recovers', async (error) => {
      const network = createBitcoinCashNetwork();
      const param = new BitcoinCashRpcAssetHealthCheckParam(
        network,
        address,
        100n,
        50n,
      );
      const health = new HealthCheck();
      health.register(param);
      await health.updateParam(param.getId());
      const lookup = mockBitcoinCashFailure(network, error);
      await health.updateParam(param.getId());
      const status = await health.getHealthStatusWithParamId(param.getId());
      expect(status?.status).toEqual(HealthStatusLevel.BROKEN);
      expect(status?.lastTrialErrorTime).toBeInstanceOf(Date);
      expect(status?.lastTrialErrorMessage).toEqual(
        'BCH treasury balance update failed',
      );
      expect(JSON.stringify(status)).not.toContain('secret-');
      expect(param.getDescription()).toContain('unknown');
      lookup.mockResolvedValue({ nativeToken: 100n, tokens: [] });
      await health.updateParam(param.getId());
      expect(param.getLastTrialErrorTime()).toBeUndefined();
      expect(param.getLastTrialErrorMessage()).toBeUndefined();
      expect(param.getHealthStatus()).toEqual(HealthStatusLevel.HEALTHY);
    });
  });
});
