import { BUILD_ID } from '@cursebound/protocol';

// Cloud service configuration from the environment (docs/contracts/ONLINE_CONTRACT.md). Secrets come from Secret
// Manager as env vars on Cloud Run (DATABASE_URL, TURN_SECRET); nothing here is ever logged.

export interface CloudConfig {
  port: number;
  host: string;
  /** postgres://… (a Cloud SQL socket works: `?host=/cloudsql/PROJECT:REGION:INSTANCE`); null = caller supplies the db */
  databaseUrl: string | null;
  /** exact extra origins allowed by CORS; http://127.0.0.1:* and http://localhost:* are always allowed */
  corsOrigins: string[];
  turnSecret: string | null;
  /** coturn host[:port] (port defaults to 3478) */
  turnHost: string | null;
  minClientBuild: string | null;
  build: string;
  registerPerHour: number;
  /** requests per minute per client address across the API */
  ratePerMinute: number;
  /**
   * How many proxies in front of us append to X-Forwarded-For. Cloud Run's front end appends the address it saw,
   * so the right-most entry is trustworthy (1). Behind an extra load balancer use 2. 0 = use the socket peer.
   */
  trustProxyHops: number;
}

const int = (v: string | undefined, d: number, min = 0) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isSafeInteger(n) && n >= min ? n : d;
};

export function loadCloudConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig {
  const onCloudRun = !!env.K_SERVICE;
  return {
    port: int(env.PORT, 8080),
    host: env.HOST || (onCloudRun || env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
    databaseUrl: env.DATABASE_URL || null,
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean),
    turnSecret: env.TURN_SECRET || null,
    turnHost: env.TURN_HOST || null,
    minClientBuild: env.MIN_CLIENT_BUILD || null,
    build: env.CLOUD_BUILD || BUILD_ID,
    registerPerHour: int(env.REGISTER_PER_HOUR, 20, 1),
    ratePerMinute: int(env.RATE_PER_MINUTE, 600, 1),
    trustProxyHops: int(env.TRUST_PROXY_HOPS, onCloudRun ? 1 : 0),
  };
}
