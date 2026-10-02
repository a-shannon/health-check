# @rosen-bridge/asset-check

## Table of contents

- [Introduction](#introduction)
- [Installation](#installation)

## Introduction

## Installation

npm:

```sh
npm i @rosen-bridge/asset-check
```

yarn:

```sh
yarn add @rosen-bridge/asset-check
```

## Bitcoin Cash

`BitcoinCashRpcAssetHealthCheckParam` monitors confirmed, spendable native BCH
with a `BitcoinCashAssetNetwork` adapter. The BCHN network adapter from
`@rosen-chains/bitcoin-cash-rpc` supplies this interface through
`getAddressAssets(address)`. It authenticates the selected BCH network and
returns native satoshis as `bigint`; its treasury balance excludes unconfirmed,
immature, spent and token-bearing UTXOs. Wallet address import and rescan are
operator responsibilities.

```typescript
import { BitcoinCashRpcAssetHealthCheckParam } from '@rosen-bridge/asset-check';

const param = new BitcoinCashRpcAssetHealthCheckParam(
  bitcoinCashRpcNetwork,
  treasuryCashAddr,
  100_000n, // warning threshold, in satoshis
  50_000n, // critical threshold, in satoshis
);
healthCheck.register(param);
```

Thresholds and balances use native satoshis independently of wrapped-token
decimals. Balances below the critical threshold are broken; balances from the
critical threshold up to the warning threshold are unstable; balances at or
above the warning threshold are healthy. The balance is unknown before the
first successful update and after any failed update, including an invalid
native-asset response. Adapter error contents are replaced with a fixed message
before the health framework records them.
