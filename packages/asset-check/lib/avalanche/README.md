# Avalanche asset health

`AvalancheRpcAssetHealthCheckParam` extends `AbstractAssetHealthCheckParam` for
native AVAX or an admitted mapped ERC20 asset. Supply explicit chainId 43113 or
43114, a stable sourceId, the monitored C-Chain address, and warning/critical
thresholds in raw asset units. AVAX thresholds use wei.
Balances at a threshold are classified in that threshold's severity.

The source must provide `expectedChainId`, `assertNetwork()` and
`getAddressBalanceForNativeToken(address)`. Its balance method must qualify a
canonical finalized execution block; a generic EVM reader that uses `latest`
does not satisfy this contract. The health parameter checks network identity
before and after the read, validates uint256 balance bounds, captures policy
values and refuses changed source identity or methods during an update.

Omit `token` for AVAX. For an admitted ERC20 asset, set `token` to its normalized
lowercase contract `tokenId`, display `name` and execution `decimals`. The source
must also provide `getAddressBalanceForERC20Asset(address, tokenId)` with the
same finalized qualification. Thresholds and returned balances stay in that
asset's raw execution units; display decimals never rescale the comparison.
Instantiate one parameter per admitted asset. The caller owns token admission.

Create separate instances with different sourceId values for independent
providers. The consumer selects and qualifies those sources; this class does
not implement RPC failover or prove endpoint independence. It does not authorize
payments or signing and cannot establish finality for a source that omits its
required qualification.

Pending and failed updates report BROKEN. Overlapping updates retain only the
newest attempt's status and metadata. Error details exclude provider messages.

`getLastUpdatedTime()` is the local status-assessment time. Initial and pending
BROKEN states have this timestamp so the shared notification/history consumer
can record them. It is not a qualified balance timestamp.
`getLastBalanceObservedTime()` separately records the local completion time of
the last successful qualified balance read and remains absent before success.
An older completion cannot update either timestamp while a newer attempt owns
the status. These clocks do not represent blockchain block timestamps.

The Guard's Avalanche RPC adapter supplies this source interface. Its existing
asset health registration instantiates this shared parameter for AVAX and each
admitted mapped ERC20 asset with the prepared chainId/sourceId/lock address and
configured raw-unit thresholds.
Scanner/source health checks remain separate.
