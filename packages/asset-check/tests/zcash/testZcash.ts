import { ZcashRpcAssetHealthCheckParam } from '../../lib/zcash/rpc';

export class TestZcashRpcAssetHealthCheck extends ZcashRpcAssetHealthCheckParam {
  getTokenAmount = () => this.tokenAmount;
}
