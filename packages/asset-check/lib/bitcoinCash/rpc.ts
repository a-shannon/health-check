import { HealthStatusLevel } from '@rosen-bridge/health-check';

import { AbstractAssetHealthCheckParam } from '../abstract';
import { BITCOIN_CASH_NATIVE_ASSET } from '../constants';
import { BitcoinCashAssetNetwork } from './types';

const MAX_NATIVE_SATOSHIS = 2_100_000_000_000_000n;

/** Monitors available native BCH satoshis through a validated BCHN adapter. */
export class BitcoinCashRpcAssetHealthCheckParam extends AbstractAssetHealthCheckParam {
  private balanceKnown = false;

  /**
   * create a BCH treasury check with exact satoshi thresholds
   * @param network BCHN adapter that validates network identity and UTXOs
   * @param address validated treasury CashAddr
   * @param warnThreshold minimum balance for healthy status, in satoshis
   * @param criticalThreshold minimum balance for unstable status, in satoshis
   */
  constructor(
    private readonly network: BitcoinCashAssetNetwork,
    address: string,
    warnThreshold: bigint,
    criticalThreshold: bigint,
  ) {
    super(
      'bitcoin-cash',
      BITCOIN_CASH_NATIVE_ASSET,
      'BCH',
      address,
      warnThreshold,
      criticalThreshold,
      8,
    );
    if (
      typeof warnThreshold !== 'bigint' ||
      typeof criticalThreshold !== 'bigint' ||
      criticalThreshold < 0n ||
      warnThreshold > MAX_NATIVE_SATOSHIS ||
      criticalThreshold > warnThreshold
    )
      throw Error('Invalid BCH health thresholds');
  }

  /**
   * describe the latest available native balance without decimal conversion
   * @returns native satoshi balance or its unknown state
   */
  getDescription = (): string =>
    this.balanceKnown
      ? `Native BCH treasury balance is ${this.tokenAmount} satoshis.`
      : 'Native BCH treasury balance is unknown.';

  /**
   * explain unavailable balances and exact threshold shortfalls
   * @returns balance detail, or undefined when the warning threshold is met
   */
  getDetails = (): string | undefined => {
    if (!this.balanceKnown) return 'BCH treasury balance is unavailable.';
    if (this.tokenAmount < this.criticalThreshold)
      return `BCH treasury balance is below the critical threshold of ${this.criticalThreshold} satoshis.`;
    if (this.tokenAmount < this.warnThreshold)
      return `BCH treasury balance is below the warning threshold of ${this.warnThreshold} satoshis.`;
    return undefined;
  };

  /**
   * compare confirmed native satoshis with thresholds, failing closed if unknown
   * @returns native treasury health status
   */
  getHealthStatus = (): HealthStatusLevel => {
    if (!this.balanceKnown || this.tokenAmount < this.criticalThreshold)
      return HealthStatusLevel.BROKEN;
    if (this.tokenAmount < this.warnThreshold)
      return HealthStatusLevel.UNSTABLE;
    return HealthStatusLevel.HEALTHY;
  };

  /**
   * fetch and validate the available native balance, invalidating stale success
   * @throws sanitized error when the adapter fails or returns invalid assets
   */
  updateStatus = async (): Promise<void> => {
    this.balanceKnown = false;
    this.tokenAmount = 0n;
    try {
      const assets = await this.network.getAddressAssets(this.address);
      if (
        typeof assets.nativeToken !== 'bigint' ||
        assets.nativeToken < 0n ||
        assets.nativeToken > MAX_NATIVE_SATOSHIS ||
        !Array.isArray(assets.tokens) ||
        assets.tokens.length !== 0
      )
        throw Error('Invalid native BCH balance');
      this.tokenAmount = assets.nativeToken;
      this.balanceKnown = true;
    } catch {
      // Adapter errors may contain RPC credentials or server-provided text.
      throw Error('BCH treasury balance update failed');
    }
  };
}
