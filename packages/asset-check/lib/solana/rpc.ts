import { randomBytes } from 'node:crypto';

import JsonBigInt from '@rosen-bridge/json-bigint';
import axios, { type Axios } from '@rosen-clients/rate-limited-axios';

import { AbstractAssetHealthCheckParam } from '../abstract';
import { SOLANA_NATIVE_ASSET } from '../constants';

const MAX_U64 = (1n << 64n) - 1n;

/** Checks an unknown parsed JSON value for a plain record shape. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks whether a parsed JSON integer is within the Solana u64 range. */
const isU64 = (value: unknown): value is bigint =>
  typeof value === 'bigint' && value >= 0n && value <= MAX_U64;

/** Detects fractional or exponent-form JSON numbers outside quoted strings. */
const hasNonIntegerNumberLexeme = (json: string): boolean => {
  for (const [, number] of json.matchAll(
    /"(?:[^"\\]|\\.)*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
  ))
    if (number !== undefined && /[.eE]/.test(number)) return true;

  return false;
};

export class SolanaRpcAssetHealthCheckParam extends AbstractAssetHealthCheckParam {
  private readonly client: Axios;

  /** Creates a native SOL balance check for one address and RPC endpoint. */
  constructor(
    address: string,
    warnThreshold: bigint,
    criticalThreshold: bigint,
    rpcUrl: string,
    client?: Axios,
  ) {
    super(
      'Solana',
      SOLANA_NATIVE_ASSET,
      'SOL',
      address,
      warnThreshold,
      criticalThreshold,
      9,
    );
    this.client =
      client ??
      axios.create({
        baseURL: rpcUrl,
        headers: { 'Content-Type': 'application/json' },
      });
  }

  /** Updates the SOL balance using the finalized Solana JSON-RPC balance. */
  updateStatus = async () => {
    const id = randomBytes(32).toString('hex');
    const response = await this.client.post<string>(
      '',
      {
        jsonrpc: '2.0',
        id,
        method: 'getBalance',
        params: [this.address, { commitment: 'finalized' }],
      },
      { responseType: 'text' },
    );

    if (typeof response.data !== 'string')
      throw new Error('INVALID_SOLANA_RPC_BODY');

    let payload: unknown;
    if (hasNonIntegerNumberLexeme(response.data))
      throw new Error('INVALID_SOLANA_RPC_JSON');

    try {
      payload = JsonBigInt.parse(response.data);
    } catch {
      throw new Error('INVALID_SOLANA_RPC_JSON');
    }

    if (
      !isRecord(payload) ||
      payload.jsonrpc !== '2.0' ||
      payload.id !== id ||
      Object.prototype.hasOwnProperty.call(payload, 'error') ||
      !isRecord(payload.result) ||
      !isRecord(payload.result.context) ||
      !isU64(payload.result.value) ||
      !isU64(payload.result.context.slot)
    )
      throw new Error('INVALID_SOLANA_BALANCE_RESPONSE');

    this.tokenAmount = payload.result.value;
  };
}
