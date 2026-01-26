/**
 * API module exports
 */

export {
  GatewayClient,
  createGatewayClient,
} from './gateway-client';

export type {
  GatewayConfig,
  InvokeRequest,
  InvokeResponse,
  AgentTrace,
  AgentReasoning,
  StreamChunk,
  AuthMethod,
  AuthConfig,
} from './gateway-client';

export {
  AuthService,
  createAuthService,
} from './auth';

export type {
  AWSCredentials,
  AuthHeaders,
} from './auth';

export {
  sha256,
  hmacSha256,
  bufferToHex,
  hexToBuffer,
  base64Encode,
  base64Decode,
} from './crypto-utils';
