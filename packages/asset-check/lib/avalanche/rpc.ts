import { getAddress } from 'ethers';

import { HealthStatusLevel } from '@rosen-bridge/health-check';

import { AbstractAssetHealthCheckParam } from '../abstract';

/** A source must qualify raw balances against canonical finalized execution. */
export interface AvalancheAssetSource {
  readonly expectedChainId: bigint;
  assertNetwork: () => Promise<void>;
  getAddressBalanceForNativeToken: (address: string) => Promise<bigint>;
  getAddressBalanceForERC20Asset?: (
    address: string,
    tokenId: string,
  ) => Promise<bigint>;
}

/** Thresholds use raw asset units and the network selection is explicit. */
export interface AvalancheAssetHealthConfig {
  readonly chainId: 43113 | 43114;
  readonly sourceId: string;
  readonly address: string;
  readonly warnThreshold: bigint;
  readonly criticalThreshold: bigint;
  /** Admitted mapped ERC20 identity; thresholds use its raw execution units. */
  readonly token?: Readonly<{
    tokenId: string;
    name: string;
    decimals: number;
  }>;
}

/** Native or admitted mapped-token health; the source owns settlement validation. */
export class AvalancheRpcAssetHealthCheckParam extends AbstractAssetHealthCheckParam {
  readonly #source: AvalancheAssetSource;
  readonly #chainId: bigint;
  readonly #sourceId: string;
  readonly #address: string;
  readonly #warn: bigint;
  readonly #critical: bigint;
  readonly #assertNetwork: AvalancheAssetSource['assertNetwork'];
  readonly #balance: AvalancheAssetSource['getAddressBalanceForNativeToken'];
  readonly #tokenBalance: AvalancheAssetSource['getAddressBalanceForERC20Asset'];
  readonly #token:
    | Readonly<{ tokenId: string; name: string; decimals: number }>
    | undefined;
  #generation = 0n;
  #assessedAt = Date.now();
  #balanceObservedAt: number | undefined;
  #status = HealthStatusLevel.BROKEN;
  #details: string | undefined =
    'No Avalanche native balance has been observed.';

  /** Capture immutable policy and source methods before any network access. */
  constructor(
    config: AvalancheAssetHealthConfig,
    source: AvalancheAssetSource,
  ) {
    const maximum = (1n << 256n) - 1n;
    if (
      !config ||
      (config.chainId !== 43113 && config.chainId !== 43114) ||
      typeof config.sourceId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.sourceId) ||
      typeof config.warnThreshold !== 'bigint' ||
      typeof config.criticalThreshold !== 'bigint' ||
      config.criticalThreshold < 0n ||
      config.warnThreshold < config.criticalThreshold ||
      config.warnThreshold > maximum ||
      !source ||
      source.expectedChainId !== BigInt(config.chainId) ||
      typeof source.assertNetwork !== 'function' ||
      typeof source.getAddressBalanceForNativeToken !== 'function'
    )
      throw new Error('Invalid Avalanche asset health configuration');
    const address = getAddress(config.address);
    if (address === '0x0000000000000000000000000000000000000000')
      throw new Error('Invalid Avalanche asset health address');
    const token = config.token;
    if (
      token !== undefined &&
      (!token ||
        typeof token !== 'object' ||
        Array.isArray(token) ||
        typeof token.tokenId !== 'string' ||
        !/^0x[0-9a-f]{40}$/.test(token.tokenId) ||
        token.tokenId === '0x0000000000000000000000000000000000000000' ||
        typeof token.name !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(token.name) ||
        !Number.isSafeInteger(token.decimals) ||
        token.decimals < 0 ||
        token.decimals > 255 ||
        typeof source.getAddressBalanceForERC20Asset !== 'function')
    )
      throw new Error('Invalid Avalanche token health configuration');
    super(
      'avalanche',
      token?.tokenId ?? 'avax',
      token?.name ?? 'AVAX',
      address,
      config.warnThreshold,
      config.criticalThreshold,
      token?.decimals ?? 18,
    );
    this.#chainId = BigInt(config.chainId);
    this.#sourceId = config.sourceId;
    this.#address = address;
    this.#warn = config.warnThreshold;
    this.#critical = config.criticalThreshold;
    this.#source = source;
    this.#assertNetwork = source.assertNetwork;
    this.#balance = source.getAddressBalanceForNativeToken;
    this.#tokenBalance = source.getAddressBalanceForERC20Asset;
    this.#token = token ? Object.freeze({ ...token }) : undefined;
    if (token) this.#details = 'No Avalanche ERC20 balance has been observed.';
  }

  /** Refuse a changed adapter identity or implementation during an update. */
  private assertSource = (): void => {
    if (
      this.#source.expectedChainId !== this.#chainId ||
      this.#source.assertNetwork !== this.#assertNetwork ||
      this.#source.getAddressBalanceForNativeToken !== this.#balance ||
      (this.#token &&
        this.#source.getAddressBalanceForERC20Asset !== this.#tokenBalance)
    )
      throw new Error('Avalanche asset health source changed');
  };

  /** Distinguish source, selected network and canonical address instances. */
  getId = (): string =>
    `asset_${this.#token?.tokenId ?? 'avax'}_${this.#chainId}_${this.#sourceId}_${this.#address}`;

  /** Return the current attempt's fail-closed status. */
  getHealthStatus = (): HealthStatusLevel => this.#status;

  /** Return sanitized current-attempt details. */
  getDetails = (): string | undefined => this.#details;

  /** Local status-assessment time, including initial and pending BROKEN states. */
  getLastUpdatedTime = (): Date => new Date(this.#assessedAt);

  /** Local completion time of the last qualified balance; absent before success. */
  getLastBalanceObservedTime = (): Date | undefined =>
    this.#balanceObservedAt === undefined
      ? undefined
      : new Date(this.#balanceObservedAt);

  /** Qualify balance and retain only the latest attempt's result and metadata. */
  updateStatus = async (): Promise<void> => {
    const generation = ++this.#generation;
    this.#status = HealthStatusLevel.BROKEN;
    this.#details = 'Avalanche health observation is pending.';
    this.#assessedAt = Date.now();
    this.lastTrialErrorMessage = undefined;
    this.lastTrialErrorTime = undefined;
    try {
      this.assertSource();
      await this.#assertNetwork.call(this.#source);
      this.assertSource();
      const balance = this.#token
        ? await this.#tokenBalance!.call(
            this.#source,
            this.#address,
            this.#token.tokenId,
          )
        : await this.#balance.call(this.#source, this.#address);
      this.assertSource();
      await this.#assertNetwork.call(this.#source);
      this.assertSource();
      if (
        typeof balance !== 'bigint' ||
        balance < 0n ||
        balance > (1n << 256n) - 1n
      )
        throw new Error('Invalid Avalanche balance');
      if (generation !== this.#generation) return;
      this.tokenAmount = balance;
      this.#status =
        balance <= this.#critical
          ? HealthStatusLevel.BROKEN
          : balance <= this.#warn
            ? HealthStatusLevel.UNSTABLE
            : HealthStatusLevel.HEALTHY;
      this.#details =
        this.#status === HealthStatusLevel.HEALTHY
          ? undefined
          : `${this.#token ? 'ERC20' : 'Native AVAX'} balance is at or below the ${
              this.#status === HealthStatusLevel.BROKEN ? 'critical' : 'warning'
            } threshold.`;
      this.#assessedAt = Date.now();
      this.#balanceObservedAt = this.#assessedAt;
      this.lastTrialErrorMessage = undefined;
      this.lastTrialErrorTime = undefined;
    } catch {
      if (generation === this.#generation) {
        this.#status = HealthStatusLevel.BROKEN;
        this.#details = `Unable to read Avalanche ${this.#token ? 'ERC20' : 'native'} balance.`;
        this.#assessedAt = Date.now();
        this.lastTrialErrorMessage = this.#details;
        this.lastTrialErrorTime = new Date();
      }
      throw new Error(
        `Unable to read Avalanche ${this.#token ? 'ERC20' : 'native'} balance.`,
      );
    }
  };

  /** Preserve attempt-owned metadata instead of the base update's late writes. */
  update = async (): Promise<void> => {
    try {
      await this.updateStatus();
    } catch {
      // updateStatus records a sanitized error for the latest attempt only.
    }
  };
}
