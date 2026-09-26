export interface ZcashAddressBalance {
  balance: unknown;
}

export interface ZcashRpcError {
  code?: unknown;
  message?: unknown;
}

export interface ZcashRpcResponse<T> {
  jsonrpc?: unknown;
  id?: unknown;
  result?: T;
  error?: ZcashRpcError | null;
}
