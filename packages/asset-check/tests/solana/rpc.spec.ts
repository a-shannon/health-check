import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthStatusLevel } from '@rosen-bridge/health-check';
import type { Axios } from '@rosen-clients/rate-limited-axios';

import { SolanaRpcAssetHealthCheckParam } from '../../lib/solana/rpc';

const { mockClient, mockCreate } = vi.hoisted(() => ({
  mockClient: { post: vi.fn() },
  mockCreate: vi.fn(),
}));

vi.mock('@rosen-clients/rate-limited-axios', () => ({
  default: { create: mockCreate },
}));

class TestSolanaRpcAssetHealthCheckParam extends SolanaRpcAssetHealthCheckParam {
  getTokenAmount = () => this.tokenAmount;
}

const mockPostResponse = (buildResponse: (id: string) => string) => {
  mockClient.post.mockImplementationOnce(
    async (_url: string, body: unknown, options: { responseType?: string }) => {
      const { id } = body as { id: string };
      expect(options.responseType).toBe('text');
      return { data: buildResponse(id) };
    },
  );
};

const successResponse = (id: string, value: string, slot = '123') =>
  `{"jsonrpc":"2.0","result":{"context":{"slot":${slot}},"value":${value}},"id":"${id}"}`;

const createParam = (
  client = mockClient as unknown as Axios,
  warnThreshold = 1_000_000_000n,
  criticalThreshold = 100_000_000n,
) =>
  new TestSolanaRpcAssetHealthCheckParam(
    'SolanaFeeAddress111111111111111111111111111',
    warnThreshold,
    criticalThreshold,
    'https://rpc.example.invalid',
    client,
  );

type InvalidResponseCase = {
  title: string;
  response: (id: string) => string;
  expectedError?: string;
};

describe('SolanaRpcAssetHealthCheckParam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReturnValue(mockClient);
  });

  describe('constructor', () => {
    /**
     * @target constructor should configure the RPC URL for the default client
     * @dependencies
     * - @rosen-clients/rate-limited-axios
     * @scenario
     * - create the parameter without an injected client
     * - inspect the client configuration
     * @expected
     * - The default client should use the configured URL and JSON content type
     */
    it('should configure the RPC URL for the default client', () => {
      new TestSolanaRpcAssetHealthCheckParam(
        'SolanaFeeAddress111111111111111111111111111',
        1_000_000_000n,
        100_000_000n,
        'https://rpc.example.invalid/custom',
      );

      expect(mockCreate).toHaveBeenCalledWith({
        baseURL: 'https://rpc.example.invalid/custom',
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('updateStatus', () => {
    /**
     * @target updateStatus should preserve lamports above the safe integer
     *         exactly
     * @dependencies
     * - @rosen-clients/rate-limited-axios
     * - @rosen-bridge/json-bigint
     * @scenario
     * - mock a getBalance result above Number.MAX_SAFE_INTEGER
     * - update the parameter
     * @expected
     * - The exact lamport amount should be stored and finalized commitment
     *   requested
     */
    it('should parse lamports above the safe integer exactly', async () => {
      const param = createParam();
      mockPostResponse((id) => successResponse(id, '9007199254740993'));

      await param.update();

      expect(param.getTokenAmount()).toBe(9007199254740993n);
      expect(mockClient.post).toHaveBeenCalledWith(
        '',
        expect.objectContaining({
          jsonrpc: '2.0',
          method: 'getBalance',
          params: [
            'SolanaFeeAddress111111111111111111111111111',
            { commitment: 'finalized' },
          ],
        }),
        { responseType: 'text' },
      );
    });

    /**
     * @target updateStatus should accept the maximum u64 balance
     * @dependencies
     * - @rosen-clients/rate-limited-axios
     * - @rosen-bridge/json-bigint
     * @scenario
     * - mock getBalance with the largest representable u64 lamport value
     * - update the parameter
     * @expected
     * - The maximum u64 should be stored without rounding
     */
    it('should accept the maximum u64 balance', async () => {
      const param = createParam();
      mockPostResponse((id) => successResponse(id, '18446744073709551615'));

      await param.update();

      expect(param.getTokenAmount()).toBe(18446744073709551615n);
    });

    /**
     * @target updateStatus should ignore exponent-like text inside JSON strings
     * @dependencies
     * - @rosen-bridge/json-bigint
     * @scenario
     * - include exponent-like and escaped-quote text in an unrelated string
     * - update with an otherwise valid integer balance and context slot
     * @expected
     * - Quoted digits should not be classified as non-integer JSON numbers
     */
    it('should ignore exponent-like text inside JSON strings', async () => {
      const param = createParam();
      mockPostResponse((id) => {
        const response = successResponse(id, '7');
        const metadata = JSON.stringify('text 1e5 and escaped " 9E4');
        return response.replace(
          `,"id":"${id}"`,
          `,"metadata":${metadata},"id":"${id}"`,
        );
      });

      await param.update();

      expect(param.getTokenAmount()).toBe(7n);
      expect(param.getLastTrialErrorMessage()).toBeUndefined();
    });

    /**
     * @target updateStatus should accept a genuine zero balance
     * @dependencies
     * - @rosen-clients/rate-limited-axios
     * - @rosen-bridge/json-bigint
     * @scenario
     * - mock a well-formed getBalance response with value zero
     * - update the parameter
     * @expected
     * - Zero should be stored with no trial error
     */
    it('should accept a genuine zero balance', async () => {
      const param = createParam();
      mockPostResponse((id) => successResponse(id, '0'));

      await param.update();

      expect(param.getTokenAmount()).toBe(0n);
      expect(param.getLastTrialErrorMessage()).toBeUndefined();
      expect(param.getLastUpdatedTime()).toBeInstanceOf(Date);
    });

    /**
     * @target updateStatus should format nine decimals and recover threshold
     *         status
     * @dependencies
     * - @rosen-clients/rate-limited-axios
     * - @rosen-bridge/json-bigint
     * @scenario
     * - update with values below critical, between thresholds, and above
     *   warning
     * - inspect the formatted balance and status after each update
     * @expected
     * - The display should use SOL decimals and status should recover as
     *   balance rises
     */
    it('should format nine decimals and recover threshold status', async () => {
      const param = createParam();
      mockPostResponse((id) => successResponse(id, '50000000'));
      await param.update();
      expect(param.getHealthStatus()).toBe(HealthStatusLevel.BROKEN);
      expect(param.getDescription()).toContain('0.05.');

      mockPostResponse((id) => successResponse(id, '250000000'));
      await param.update();
      expect(param.getHealthStatus()).toBe(HealthStatusLevel.UNSTABLE);

      mockPostResponse((id) => successResponse(id, '2000000000'));
      await param.update();
      expect(param.getHealthStatus()).toBe(HealthStatusLevel.HEALTHY);
      expect(param.getDescription()).toContain('balance is 2.');
    });

    /**
     * @target updateStatus should validate one malformed response field at a
     *         time
     * @dependencies
     * - @rosen-clients/rate-limited-axios
     * - @rosen-bridge/json-bigint
     * - AbstractHealthCheckParam.update
     * @scenario
     * - seed a prior valid balance
     * - return one malformed envelope, context, or value for each table case
     * - update the parameter
     * @expected
     * - Each invalid response should mark the trial unknown without replacing
     *   the amount or last success time
     */
    it.each([
      {
        title: 'should reject a mismatched response id',
        response: (id: string) => successResponse(`${id}-wrong`, '7'),
      },
      {
        title: 'should reject an unsupported JSON-RPC version',
        response: (id: string) =>
          successResponse(id, '7').replace(
            '"jsonrpc":"2.0"',
            '"jsonrpc":"1.0"',
          ),
      },
      {
        title: 'should reject a JSON-RPC error response',
        response: (id: string) =>
          `{"jsonrpc":"2.0","result":{"context":{"slot":1},"value":7},"error":{"code":-32000,"message":"unavailable"},"id":"${id}"}`,
      },
      {
        title: 'should reject a null JSON-RPC error member',
        response: (id: string) =>
          `{"jsonrpc":"2.0","result":{"context":{"slot":1},"value":7},"error":null,"id":"${id}"}`,
      },
      {
        title: 'should reject a null result',
        response: (id: string) =>
          `{"jsonrpc":"2.0","result":null,"id":"${id}"}`,
      },
      {
        title: 'should reject an array result',
        response: (id: string) => `{"jsonrpc":"2.0","result":[],"id":"${id}"}`,
      },
      {
        title: 'should reject a null top-level response',
        response: () => 'null',
      },
      {
        title: 'should reject a scalar top-level response',
        response: () => '7',
      },
      {
        title: 'should reject an array top-level response',
        response: () => '[]',
      },
      {
        title: 'should reject a result without context',
        response: (id: string) =>
          `{"jsonrpc":"2.0","result":{"value":7},"id":"${id}"}`,
      },
      {
        title: 'should reject a null context',
        response: (id: string) =>
          `{"jsonrpc":"2.0","result":{"context":null,"value":7},"id":"${id}"}`,
      },
      {
        title: 'should reject an array context',
        response: (id: string) =>
          `{"jsonrpc":"2.0","result":{"context":[],"value":7},"id":"${id}"}`,
      },
      {
        title: 'should reject a result without value',
        response: (id: string) =>
          `{"jsonrpc":"2.0","result":{"context":{"slot":1}},"id":"${id}"}`,
      },
      {
        title: 'should reject a null lamport value',
        response: (id: string) =>
          `{"jsonrpc":"2.0","result":{"context":{"slot":1},"value":null},"id":"${id}"}`,
      },
      {
        title: 'should reject a boolean lamport value',
        response: (id: string) =>
          `{"jsonrpc":"2.0","result":{"context":{"slot":1},"value":true},"id":"${id}"}`,
      },
      {
        title: 'should reject a quoted value instead of a JSON integer',
        response: (id: string) => successResponse(id, '"7"'),
      },
      {
        title: 'should reject a fractional lamport value',
        response: (id: string) => successResponse(id, '1.5'),
      },
      {
        title: 'should reject a short scientific lamport lexeme exactly',
        response: (id: string) => successResponse(id, '9007199254741e5'),
        expectedError: 'INVALID_SOLANA_RPC_JSON',
      },
      {
        title: 'should reject an uppercase exponent lamport lexeme',
        response: (id: string) => successResponse(id, '7E0'),
        expectedError: 'INVALID_SOLANA_RPC_JSON',
      },
      {
        title: 'should reject an integral decimal lamport lexeme',
        response: (id: string) => successResponse(id, '7.0'),
        expectedError: 'INVALID_SOLANA_RPC_JSON',
      },
      {
        title: 'should reject a negative lamport value',
        response: (id: string) => successResponse(id, '-1'),
      },
      {
        title: 'should reject a lamport value above u64',
        response: (id: string) => successResponse(id, '18446744073709551616'),
      },
      {
        title: 'should reject a fractional context slot',
        response: (id: string) => successResponse(id, '7', '1.5'),
      },
      {
        title: 'should reject a scientific context slot lexeme',
        response: (id: string) => successResponse(id, '7', '1e3'),
        expectedError: 'INVALID_SOLANA_RPC_JSON',
      },
      {
        title: 'should reject a missing context slot',
        response: (id: string) =>
          `{"jsonrpc":"2.0","result":{"context":{},"value":7},"id":"${id}"}`,
      },
      {
        title: 'should reject a null context slot',
        response: (id: string) => successResponse(id, '7', 'null'),
      },
      {
        title: 'should reject a quoted context slot',
        response: (id: string) => successResponse(id, '7', '"1"'),
      },
      {
        title: 'should reject a negative context slot',
        response: (id: string) => successResponse(id, '7', '-1'),
      },
      {
        title: 'should reject a context slot above u64',
        response: (id: string) =>
          successResponse(id, '7', '18446744073709551616'),
      },
    ] as InvalidResponseCase[])(
      '$title',
      async ({ response, expectedError }) => {
        const param = createParam();
        mockPostResponse((id) => successResponse(id, '2000000000'));
        await param.update();
        const lastAmount = param.getTokenAmount();
        const lastSuccess = param.getLastUpdatedTime();

        mockPostResponse(response);
        await param.update();

        expect(param.getTokenAmount()).toBe(lastAmount);
        expect(param.getLastUpdatedTime()).toBe(lastSuccess);
        if (expectedError)
          expect(param.getLastTrialErrorMessage()).toBe(expectedError);
        else expect(param.getLastTrialErrorMessage()).toBeDefined();
        expect(param.getLastTrialErrorTime()).toBeInstanceOf(Date);
      },
    );

    /**
     * @target updateStatus should reject an already-parsed response body
     * @dependencies
     * - @rosen-clients/rate-limited-axios
     * - @rosen-bridge/json-bigint
     * - AbstractHealthCheckParam.update
     * @scenario
     * - seed a prior valid balance
     * - return an object instead of raw response text
     * - update the parameter
     * @expected
     * - The trial should be unknown and the prior balance should remain
     *   unchanged
     */
    it('should reject an already-parsed response body', async () => {
      const param = createParam();
      mockPostResponse((id) => successResponse(id, '2000000000'));
      await param.update();
      const lastSuccess = param.getLastUpdatedTime();

      mockClient.post.mockImplementationOnce(
        async (_url: string, body: unknown) => {
          const { id } = body as { id: string };
          return {
            data: {
              jsonrpc: '2.0',
              id,
              result: { context: { slot: 2n }, value: 7n },
            },
          };
        },
      );
      await param.update();

      expect(param.getTokenAmount()).toBe(2000000000n);
      expect(param.getLastUpdatedTime()).toBe(lastSuccess);
      expect(param.getLastTrialErrorMessage()).toBeDefined();
      expect(param.getLastTrialErrorTime()).toBeInstanceOf(Date);
    });

    /**
     * @target updateStatus should retain the last successful balance after
     *         transport failure
     * @dependencies
     * - @rosen-clients/rate-limited-axios
     * - AbstractHealthCheckParam.update
     * @scenario
     * - seed a prior valid balance
     * - reject the mocked RPC request
     * - update the parameter
     * @expected
     * - The prior amount and success time should remain while the trial error
     *   is recorded
     */
    it('should retain the last successful balance after transport failure', async () => {
      const param = createParam();
      mockPostResponse((id) => successResponse(id, '2000000000'));
      await param.update();
      const lastSuccess = param.getLastUpdatedTime();

      mockClient.post.mockRejectedValueOnce(new Error('RPC transport failed'));
      await param.update();

      expect(param.getTokenAmount()).toBe(2000000000n);
      expect(param.getLastUpdatedTime()).toBe(lastSuccess);
      expect(param.getHealthStatus()).toBe(HealthStatusLevel.HEALTHY);
      expect(param.getDescription()).toContain('balance is 2.');
      expect(param.getLastTrialErrorMessage()).toBe('RPC transport failed');
      expect(param.getLastTrialErrorTime()).toBeInstanceOf(Date);

      mockPostResponse((id) => successResponse(id, '500000000'));
      await param.update();

      expect(param.getTokenAmount()).toBe(500000000n);
      expect(param.getHealthStatus()).toBe(HealthStatusLevel.UNSTABLE);
      expect(param.getLastTrialErrorMessage()).toBeUndefined();
    });

    /**
     * @target updateStatus should retain the last successful balance after a
     *         parse failure
     * @dependencies
     * - @rosen-clients/rate-limited-axios
     * - @rosen-bridge/json-bigint
     * - AbstractHealthCheckParam.update
     * @scenario
     * - seed a prior valid balance
     * - return malformed raw JSON
     * - update the parameter
     * @expected
     * - The trial error should be recorded without changing the amount or last
     *   success time
     */
    it('should retain the last successful balance after a parse failure', async () => {
      const param = createParam();
      mockPostResponse((id) => successResponse(id, '2000000000'));
      await param.update();
      const lastSuccess = param.getLastUpdatedTime();

      mockClient.post.mockResolvedValueOnce({ data: '{malformed' });
      await param.update();

      expect(param.getTokenAmount()).toBe(2000000000n);
      expect(param.getLastUpdatedTime()).toBe(lastSuccess);
      expect(param.getLastTrialErrorMessage()).toBeDefined();
      expect(param.getLastTrialErrorTime()).toBeInstanceOf(Date);
    });
  });
});
