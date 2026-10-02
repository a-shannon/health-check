/** Native BCH assets returned by a validated BCHN network adapter. */
export interface BitcoinCashAssets {
  nativeToken: bigint;
  tokens: unknown[];
}

/** Supplies confirmed, spendable native satoshis for the treasury address. */
export interface BitcoinCashAssetNetwork {
  /**
   * fetch native treasury assets after authenticating the configured BCH chain
   * @param address validated treasury CashAddr
   * @returns available native satoshis and an empty token list
   */
  getAddressAssets: (address: string) => Promise<BitcoinCashAssets>;
}
