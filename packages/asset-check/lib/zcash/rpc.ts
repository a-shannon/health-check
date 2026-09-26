import { randomBytes } from 'crypto';

import axios, { Axios } from '@rosen-clients/rate-limited-axios';

import { AbstractAssetHealthCheckParam } from '../abstract';
import { ZCASH_NATIVE_ASSET } from '../constants';
import { ZcashAddressBalance, ZcashRpcResponse } from './types';

const MAX_ZATOSHIS = 2_100_000_000_000_000n;

const parseZatoshis = (value: unknown): bigint => {
  let amount: bigint;
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    !Object.is(value, -0)
  ) {
    amount = BigInt(value);
  } else if (
    typeof value === 'string' &&
    /^(0|[1-9][0-9]{0,15})$/.test(value)
  ) {
    amount = BigInt(value);
  } else {
    throw new Error('invalid Zcash balance');
  }
  if (amount < 0n || amount > MAX_ZATOSHIS)
    throw new Error('invalid Zcash balance');
  return amount;
};

export class ZcashRpcAssetHealthCheckParam extends AbstractAssetHealthCheckParam {
  protected client: Axios;

  constructor(
    assetName: string,
    address: string,
    warnThreshold: bigint,
    criticalThreshold: bigint,
    rpcUrl: string,
    rpcUsername?: string,
    rpcPassword?: string,
    assetDecimal = 8,
  ) {
    if (
      criticalThreshold <= 0n ||
      warnThreshold < criticalThreshold ||
      warnThreshold > MAX_ZATOSHIS
    ) {
      throw new Error('Invalid Zcash asset health thresholds');
    }
    super(
      'Zcash',
      ZCASH_NATIVE_ASSET,
      assetName.toUpperCase(),
      address,
      warnThreshold,
      criticalThreshold,
      assetDecimal,
    );

    const authConfig =
      rpcUsername !== undefined || rpcPassword !== undefined
        ? {
            auth: {
              username: rpcUsername ?? '',
              password: rpcPassword ?? '',
            },
          }
        : {};
    this.client = axios.create({
      baseURL: rpcUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      ...authConfig,
    });
  }

  /** Updates the transparent reserve balance in zatoshis. */
  updateStatus = async () => {
    // Invalidate the previous observation before I/O. AbstractHealthCheckParam
    // records a failed trial but otherwise retains subclass state.
    this.tokenAmount = 0n;
    try {
      const id = randomBytes(32).toString('hex');
      const response = await this.client.post<
        ZcashRpcResponse<ZcashAddressBalance>
      >('/', {
        jsonrpc: '2.0',
        id,
        method: 'getaddressbalance',
        params: [{ addresses: [this.address] }],
      });
      if (
        (response.data.jsonrpc !== undefined &&
          response.data.jsonrpc !== '2.0') ||
        response.data.id !== id
      )
        throw new Error('invalid Zcash RPC response');
      if (response.data.error !== undefined && response.data.error !== null)
        throw new Error('Zcash RPC returned an error');
      if (
        response.data.result === undefined ||
        typeof response.data.result !== 'object' ||
        response.data.result === null
      ) {
        throw new Error('invalid Zcash RPC result');
      }
      this.tokenAmount = parseZatoshis(response.data.result.balance);
    } catch {
      throw new Error('Zcash asset balance RPC request failed');
    }
  };
}
