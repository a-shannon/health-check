import { describe, expect, it, vi } from 'vitest';

import { HealthCheck, HealthStatusLevel } from '@rosen-bridge/health-check';

import {
  AvalancheAssetHealthConfig,
  AvalancheAssetSource,
  AvalancheRpcAssetHealthCheckParam,
} from '../../lib/avalanche';
import { setup as setupGuardRpc } from './avalancheRpcTestUtils';
import { setup, deferred } from './avalancheTestUtils';

describe('AvalancheRpcAssetHealthCheckParam', () => {
  describe('constructor', () => {
    /**
     * @target AvalancheRpcAssetHealthCheckParam.constructor refuses missing token port
     * @dependencies Real parameter and native-only source.
     * @scenario Configure an admitted token without its ERC20 reader.
     * @expected Refusal before network access.
     */
    it('refuses missing token port', () => {
      const { config, source } = setup();
      expect(
        () =>
          new AvalancheRpcAssetHealthCheckParam(
            {
              ...config,
              token: {
                tokenId: '0x' + '34'.repeat(20),
                name: 'JOE',
                decimals: 18,
              },
            },
            source,
          ),
      ).toThrow('token health');
      expect(source.assertNetwork).not.toHaveBeenCalled();
    });
    /**
     * @target AvalancheRpcAssetHealthCheckParam.constructor rejects invalid token %s
     * @dependencies Real parameter and synthetic source; no RPC.
     * @scenario Change exactly one token identity field.
     * @expected Refusal occurs before a source call.
     */
    it.each([
      ['tokenId', '0x' + '00'.repeat(20)],
      ['tokenId', '0x' + 'AB'.repeat(20)],
      ['name', 'bad\nname'],
      ['decimals', -1],
      ['decimals', 256],
      ['decimals', 1.5],
    ])('rejects invalid token %s', (field, value) => {
      const { config, source } = setup();
      const token = {
        tokenId: '0x' + '34'.repeat(20),
        name: 'JOE',
        decimals: 18,
        [field]: value,
      };
      expect(
        () =>
          new AvalancheRpcAssetHealthCheckParam(
            { ...config, token } as AvalancheAssetHealthConfig,
            { ...source, getAddressBalanceForERC20Asset: vi.fn() },
          ),
      ).toThrow('token health');
      expect(source.assertNetwork).not.toHaveBeenCalled();
    });
    /**
     * @target AvalancheRpcAssetHealthCheckParam.constructor rejects invalid %s: %s
     * @dependencies synthetic source only
     * @scenario change one field, construct the parameter
     * @expected exception before any source call
     */
    it.each([
      ['chainId', 1],
      ['sourceId', ''],
      ['sourceId', 'bad source'],
      ['address', '0x00'],
      ['address', '0x' + '00'.repeat(20)],
      ['warnThreshold', 9n],
      ['warnThreshold', 1n << 256n],
      ['criticalThreshold', -1n],
      ['criticalThreshold', '10'],
    ])('rejects invalid %s: %s', (field, value) => {
      const { config, source } = setup();
      expect(
        () =>
          new AvalancheRpcAssetHealthCheckParam(
            {
              ...config,
              [field as string]: value,
            } as AvalancheAssetHealthConfig,
            source,
          ),
      ).toThrow(Error);
      expect(source.assertNetwork).not.toHaveBeenCalled();
      expect(source.getAddressBalanceForNativeToken).not.toHaveBeenCalled();
    });

    /**
     * @target AvalancheRpcAssetHealthCheckParam.constructor rejects another configured network
     * @dependencies synthetic source only
     * @scenario change expected chain, construct
     * @expected rejection before RPC
     */
    it('rejects another configured network', () => {
      const { config, source } = setup();
      expect(
        () =>
          new AvalancheRpcAssetHealthCheckParam(config, {
            ...source,
            expectedChainId: 43114n,
          }),
      ).toThrow(Error);
    });
  });
  describe('updateStatus', () => {
    /**
     * @target AvalancheRpcAssetHealthCheckParam.updateStatus retains newest token attempt
     * @dependencies Real parameter, deferred old token read and independent fresh read.
     * @scenario Pause an older low balance, finish a newer healthy read, then resolve the older read.
     * @expected Older completion cannot replace status or observation time.
     */
    it('retains newest token attempt', async () => {
      const { config, source } = setup();
      const old = deferred();
      const read = vi.fn(async () => 101n).mockReturnValueOnce(old.promise);
      const health = new AvalancheRpcAssetHealthCheckParam(
        {
          ...config,
          token: { tokenId: '0x' + '34'.repeat(20), name: 'JOE', decimals: 18 },
        },
        { ...source, getAddressBalanceForERC20Asset: read },
      );
      const pending = health.updateStatus();
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      await health.updateStatus();
      const observed = health.getLastBalanceObservedTime()!.getTime();
      old.resolve(0n);
      await pending;
      expect(health.getHealthStatus()).toBe(HealthStatusLevel.HEALTHY);
      expect(health.getLastBalanceObservedTime()!.getTime()).toBe(observed);
    });
    /**
     * @target AvalancheRpcAssetHealthCheckParam.updateStatus reads retained mapped token with raw threshold %s
     * @dependencies Real parameter, controlled token/native source ports.
     * @scenario Mutate caller token identity after construction; update a raw token balance.
     * @expected Original contract/address and raw units decide severity; native port is unused.
     */
    it.each([
      [10n, HealthStatusLevel.BROKEN],
      [100n, HealthStatusLevel.UNSTABLE],
      [101n, HealthStatusLevel.HEALTHY],
      [(1n << 256n) - 1n, HealthStatusLevel.HEALTHY],
    ])(
      'reads retained mapped token with raw threshold %s',
      async (balance, status) => {
        const { config, source } = setup(43114);
        const token = {
          tokenId: '0x' + '34'.repeat(20),
          name: 'JOE',
          decimals: 18,
        };
        const read = vi.fn(async () => balance as bigint);
        const health = new AvalancheRpcAssetHealthCheckParam(
          { ...config, token },
          { ...source, getAddressBalanceForERC20Asset: read },
        );
        const id = health.getId();
        token.tokenId = '0x' + '56'.repeat(20);
        token.decimals = 9;
        await health.updateStatus();
        expect(read).toHaveBeenCalledWith(
          config.address,
          '0x' + '34'.repeat(20),
        );
        expect(source.getAddressBalanceForNativeToken).not.toHaveBeenCalled();
        expect(health.getHealthStatus()).toBe(status);
        expect(health.getId()).toBe(id);
        expect(id).toContain('asset_0x' + '34'.repeat(20));
      },
    );
    /**
     * @target AvalancheRpcAssetHealthCheckParam.updateStatus refuses token reader drift or malformed balance %s
     * @dependencies Real parameter with one synthetic retained token reader.
     * @scenario Change only the selected fault during the balance read.
     * @expected BROKEN sanitized status; no qualified balance timestamp.
     */
    it.each([
      'reader drift',
      'network drift',
      'negative',
      'overflow',
      'wrong type',
      'provider error',
    ])('refuses token reader drift or malformed balance %s', async (fault) => {
      const { config, source } = setup();
      const owner: AvalancheAssetSource = {
        ...source,
        getAddressBalanceForERC20Asset: async () => {
          if (fault === 'reader drift')
            owner.getAddressBalanceForERC20Asset = async () => 101n;
          if (fault === 'network drift')
            Reflect.set(owner, 'expectedChainId', 43114n);
          if (fault === 'provider error')
            throw new Error('private provider detail');
          return fault === 'negative'
            ? -1n
            : fault === 'overflow'
              ? 1n << 256n
              : fault === 'wrong type'
                ? ('101' as unknown as bigint)
                : 101n;
        },
      };
      const health = new AvalancheRpcAssetHealthCheckParam(
        {
          ...config,
          token: { tokenId: '0x' + '34'.repeat(20), name: 'JOE', decimals: 18 },
        },
        owner,
      );
      await expect(health.updateStatus()).rejects.toThrow(
        'Unable to read Avalanche ERC20 balance.',
      );
      expect(health.getHealthStatus()).toBe(HealthStatusLevel.BROKEN);
      expect(health.getLastBalanceObservedTime()).toBeUndefined();
      expect(health.getDetails()).not.toContain('private');
    });
    /**
     * @target AvalancheRpcAssetHealthCheckParam.updateStatus ignores inherited policy mutation before and across await
     * @dependencies controlled source and mutable inherited fields
     * @scenario mutate base fields before and during a pending balance request
     * @expected original address, ID and inclusive thresholds still apply
     */
    it('ignores inherited policy mutation before and across await', async () => {
      const { source, health } = setup();
      const id = health.getId();
      const pendingBalance = deferred();
      Object.assign(health, {
        address: '0x00',
        warnThreshold: -1n,
        criticalThreshold: -1n,
      });
      source.getAddressBalanceForNativeToken.mockReturnValueOnce(
        pendingBalance.promise,
      );
      const pending = health.updateStatus();
      await vi.waitFor(() =>
        expect(source.getAddressBalanceForNativeToken).toHaveBeenCalledTimes(1),
      );
      Object.assign(health, {
        address: '0x' + '34'.repeat(20),
        warnThreshold: 0n,
        criticalThreshold: 0n,
      });
      pendingBalance.resolve(10n);
      await pending;
      expect(health.getId()).toEqual(id);
      expect(source.getAddressBalanceForNativeToken).toHaveBeenCalledWith(
        '0x' + '12'.repeat(20),
      );
      expect(health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
      source.getAddressBalanceForNativeToken.mockResolvedValue(100n);
      await health.updateStatus();
      expect(health.getHealthStatus()).toEqual(HealthStatusLevel.UNSTABLE);
    });

    /**
     * @target AvalancheRpcAssetHealthCheckParam.updateStatus qualifies %s wei
     * @dependencies synthetic finalized-balance source
     * @scenario return a balance on either side or exactly at each threshold
     * @expected configured state and canonical address with two identity checks
     */
    it.each([
      [0n, HealthStatusLevel.BROKEN],
      [10n, HealthStatusLevel.BROKEN],
      [11n, HealthStatusLevel.UNSTABLE],
      [100n, HealthStatusLevel.UNSTABLE],
      [101n, HealthStatusLevel.HEALTHY],
    ])('qualifies %s wei', async (balance, status) => {
      const { source, health, config } = setup();
      source.getAddressBalanceForNativeToken.mockResolvedValue(balance);
      expect(health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
      await health.updateStatus();
      expect(health.getHealthStatus()).toEqual(status);
      expect(source.assertNetwork).toHaveBeenCalledTimes(2);
      expect(source.getAddressBalanceForNativeToken).toHaveBeenCalledWith(
        config.address,
      );
    });

    /**
     * @target AvalancheRpcAssetHealthCheckParam.updateStatus rejects balance %s
     * @dependencies synthetic source
     * @scenario establish healthy state, return one invalid balance
     * @expected BROKEN and sanitized failure
     */
    it.each([-1n, 1n << 256n, '101', 101])(
      'rejects balance %s',
      async (balance) => {
        const { source, health } = setup();
        await health.updateStatus();
        source.getAddressBalanceForNativeToken.mockResolvedValue(
          balance as bigint,
        );
        await expect(async () => await health.updateStatus()).rejects.toThrow(
          Error,
        );
        expect(health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
        expect(health.getLastTrialErrorMessage()).toEqual(
          'Unable to read Avalanche native balance.',
        );
      },
    );

    /**
     * @target AvalancheRpcAssetHealthCheckParam.updateStatus rejects source mutation across await
     * @dependencies mutable synthetic adapter
     * @scenario mutate chain while balance request is pending
     * @expected failed update and BROKEN
     */
    it('rejects source mutation across await', async () => {
      const { source, health } = setup();
      source.getAddressBalanceForNativeToken.mockImplementation(async () => {
        source.expectedChainId = 43114n;
        return 101n;
      });
      await expect(async () => await health.updateStatus()).rejects.toThrow(
        Error,
      );
      expect(health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
    });

    /**
     * @target AvalancheRpcAssetHealthCheckParam.updateStatus does not consume changed caller policy
     * @dependencies mutable synthetic configuration
     * @scenario alter caller thresholds and address after construction
     * @expected original captured policy still controls state and balance address
     */
    it('does not consume changed caller policy', async () => {
      const { config, health, source } = setup();
      Object.assign(config, { criticalThreshold: 1000n, address: '0x00' });
      await health.updateStatus();
      expect(health.getHealthStatus()).toEqual(HealthStatusLevel.HEALTHY);
      expect(source.getAddressBalanceForNativeToken).toHaveBeenCalledWith(
        '0x' + '12'.repeat(20),
      );
    });
  });
  describe('update', () => {
    /**
     * @target AvalancheRpcAssetHealthCheckParam.update ignores stale completion with failure=%s
     * @dependencies two controlled balance requests
     * @scenario start old request, finish new request, finish or fail old request
     * @expected new status and metadata persist
     */
    it.each([false, true])(
      'ignores stale completion with failure=%s',
      async (fails) => {
        const { source, health } = setup();
        const old = deferred();
        source.getAddressBalanceForNativeToken.mockReturnValueOnce(old.promise);
        const pending = health.update();
        await vi.waitFor(() =>
          expect(source.getAddressBalanceForNativeToken).toHaveBeenCalledTimes(
            1,
          ),
        );
        await health.update();
        const updated = health.getLastUpdatedTime();
        if (fails) old.reject(new Error('sensitive endpoint credential'));
        else old.resolve(0n);
        await pending;
        expect(health.getHealthStatus()).toEqual(HealthStatusLevel.HEALTHY);
        expect(health.getLastUpdatedTime()).toEqual(updated);
        expect(health.getLastTrialErrorMessage()).toEqual(undefined);
      },
    );

    /**
     * @target AvalancheRpcAssetHealthCheckParam.update keeps latest failure over old success
     * @dependencies controlled old request and rejected new identity check
     * @scenario fail new update, then resolve old request
     * @expected BROKEN and sanitized latest error survive
     */
    it('keeps latest failure over old success', async () => {
      const { source, health } = setup();
      const old = deferred();
      source.getAddressBalanceForNativeToken.mockReturnValueOnce(old.promise);
      const pending = health.update();
      await vi.waitFor(() =>
        expect(source.getAddressBalanceForNativeToken).toHaveBeenCalledTimes(1),
      );
      source.assertNetwork.mockRejectedValueOnce(new Error('credential'));
      await health.update();
      old.resolve(101n);
      await pending;
      expect(health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
      expect(health.getLastTrialErrorMessage()).toEqual(
        'Unable to read Avalanche native balance.',
      );
      expect(Number.isFinite(health.getLastUpdatedTime().valueOf())).toEqual(
        true,
      );
      expect(health.getLastBalanceObservedTime()).toEqual(undefined);
    });
    describe('notification/history consumer', () => {
      /**
       * @target AvalancheRpcAssetHealthCheckParam.update records old failure=%s with newest failure=%s
       * @dependencies actual HealthCheck, history, notification checks and two deferred reads
       * @scenario start two updates, resolve or reject old while newest remains pending,
       * then resolve or reject newest
       * @expected no history exception, finite timestamps, no fabricated sample,
       * BROKEN pending notification and latest outcome ownership
       */
      it.each([
        [false, false],
        [true, false],
        [false, true],
        [true, true],
      ])(
        'records old failure=%s with newest failure=%s',
        async (oldFails, newestFails) => {
          const { source, health } = setup();
          const old = deferred();
          const newest = deferred();
          const notify = vi.fn(async () => {});
          const service = new HealthCheck(notify);
          service.register(health);
          source.getAddressBalanceForNativeToken
            .mockReturnValueOnce(old.promise)
            .mockReturnValueOnce(newest.promise);
          const first = service.updateParam(health.getId());
          await vi.waitFor(() =>
            expect(
              source.getAddressBalanceForNativeToken,
            ).toHaveBeenCalledTimes(1),
          );
          const second = service.updateParam(health.getId());
          await vi.waitFor(() =>
            expect(
              source.getAddressBalanceForNativeToken,
            ).toHaveBeenCalledTimes(2),
          );
          const pendingAt = health.getLastUpdatedTime();
          if (oldFails) old.reject(new Error('sensitive credential'));
          else old.resolve(101n);
          await first;
          expect(health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
          expect(health.getLastUpdatedTime()).toEqual(pendingAt);
          expect(health.getLastBalanceObservedTime()).toEqual(undefined);
          expect(health.getLastTrialErrorMessage()).toEqual(undefined);
          expect(notify).toHaveBeenCalled();
          if (newestFails) newest.reject(new Error('sensitive credential'));
          else newest.resolve(101n);
          await second;
          expect(health.getHealthStatus()).toEqual(
            newestFails ? HealthStatusLevel.BROKEN : HealthStatusLevel.HEALTHY,
          );
          expect(health.getLastBalanceObservedTime() === undefined).toEqual(
            newestFails,
          );
          const history = (
            service as unknown as {
              healthHistory: {
                getHistory: () => Record<
                  string,
                  { timestamp: number; result: string }[]
                >;
              };
            }
          ).healthHistory.getHistory()[health.getId()];
          expect(history).toHaveLength(2);
          expect(history[0].result).toEqual(HealthStatusLevel.BROKEN);
          expect(history[1].result).toEqual(
            newestFails ? 'unknown' : HealthStatusLevel.HEALTHY,
          );
          expect(
            history.every((entry) => Number.isFinite(entry.timestamp)),
          ).toEqual(true);
          expect(JSON.stringify(notify.mock.calls)).not.toContain(
            'sensitive credential',
          );
        },
      );

      /**
       * @target AvalancheRpcAssetHealthCheckParam.update records first failure without a fabricated qualified balance
       * @dependencies actual HealthCheck/history with notification enabled
       * @scenario reject the first source identity check
       * @expected finite failure history and assessment clocks, absent sample time
       */
      it('records first failure without a fabricated qualified balance', async () => {
        const { source, health } = setup();
        const service = new HealthCheck(vi.fn(async () => {}));
        service.register(health);
        source.assertNetwork.mockRejectedValue(new Error('credential'));
        await service.update();
        expect(Number.isFinite(health.getLastUpdatedTime().valueOf())).toEqual(
          true,
        );
        expect(
          Number.isFinite(health.getLastTrialErrorTime()?.valueOf()),
        ).toEqual(true);
        expect(health.getLastBalanceObservedTime()).toEqual(undefined);
        expect(health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
      });
    });
    describe('qualified Guard RPC source', () => {
      /**
       * @target AvalancheRpcAssetHealthCheckParam.update joins shared health to the qualified Guard balance reader
       * @dependencies Real shared health and Guard RPC adapter; mocked provider.
       * @scenario Return a canonical finalized block and exact qualified Guard balance.
       * @expected Read only the finalized height and report healthy status.
       */
      it('joins shared health to the qualified Guard balance reader', async () => {
        const { health, rpc, address } = setupGuardRpc();
        await health.update();
        expect(health.getHealthStatus()).toEqual(HealthStatusLevel.HEALTHY);
        expect(rpc.getBlock).toHaveBeenCalledWith('finalized');
        expect(rpc.getBlock).not.toHaveBeenCalledWith('latest');
        expect(rpc.send).toHaveBeenCalledWith('eth_getBalance', [
          address,
          '0xc',
        ]);
        expect(rpc.send).toHaveBeenCalledWith('eth_getBlockByNumber', [
          '0xc',
          false,
        ]);
      });

      /**
       * @target AvalancheRpcAssetHealthCheckParam.update rejects %s
       * @dependencies Real shared health and Guard RPC adapter; mocked provider.
       * @scenario Establish healthy status then change one RPC qualification field.
       * @expected Report BROKEN with a sanitized error and no stale healthy credit.
       */
      it.each([
        'chain',
        'balance',
        'canonical-hash',
        'canonical-height',
        'finalized',
      ])('rejects %s', async (fault) => {
        const { health, rpc, block } = setupGuardRpc();
        await health.update();
        if (fault === 'finalized')
          rpc.getBlock.mockRejectedValue(new Error('provider credential'));
        else
          rpc.send.mockImplementation(async (method) => {
            if (method === 'eth_chainId')
              return fault === 'chain' ? '0xa86a' : '0xa869';
            if (method === 'eth_getBalance')
              return fault === 'balance' ? '0x01' : '0x65';
            if (method === 'eth_getBlockByNumber')
              return {
                number: fault === 'canonical-height' ? '0xd' : '0xc',
                hash:
                  fault === 'canonical-hash'
                    ? '0x' + 'ef'.repeat(32)
                    : block.hash,
              };
            throw new Error('Unexpected RPC');
          });
        await health.update();
        expect(health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
        expect(health.getLastTrialErrorMessage()).toEqual(
          'Unable to read Avalanche native balance.',
        );
      });
    });
  });

  describe('getId', () => {
    /**
     * @target AvalancheRpcAssetHealthCheckParam.getId supports independent configured instances
     * @dependencies synthetic sources on Fuji and mainnet
     * @scenario create two network selections and a second source
     * @expected three different health IDs
     */
    it('supports independent configured instances', () => {
      const fuji = setup();
      const mainnet = setup(43114);
      const second = new AvalancheRpcAssetHealthCheckParam(
        { ...fuji.config, sourceId: 'second-rpc' },
        fuji.source as AvalancheAssetSource,
      );
      expect(
        new Set([fuji.health.getId(), mainnet.health.getId(), second.getId()])
          .size,
      ).toEqual(3);
    });
  });
  describe('getLastUpdatedTime', () => {
    /**
     * @target AvalancheRpcAssetHealthCheckParam.getLastUpdatedTime distinguishes initial assessment from a balance observation
     * @dependencies local clock fixture only
     * @scenario construct before any source call
     * @expected finite assessment Date and absent qualified-balance time
     */
    it('distinguishes initial assessment from a balance observation', () => {
      const clock = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      try {
        const { health, source } = setup();
        expect(health.getLastUpdatedTime().valueOf()).toEqual(1700000000000);
        expect(health.getLastBalanceObservedTime()).toEqual(undefined);
        expect(health.getHealthStatus()).toEqual(HealthStatusLevel.BROKEN);
        expect(source.assertNetwork).not.toHaveBeenCalled();
        const returned = health.getLastUpdatedTime();
        returned.setTime(Number.NaN);
        expect(Number.isFinite(health.getLastUpdatedTime().valueOf())).toEqual(
          true,
        );
      } finally {
        clock.mockRestore();
      }
    });
  });
});
