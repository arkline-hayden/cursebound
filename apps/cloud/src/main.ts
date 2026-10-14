import { startCloud, type CloudServer } from './server';

// Production entry (Cloud Run): Postgres from DATABASE_URL, PORT from the platform, graceful stop on SIGTERM.

export async function runCloud(start: () => Promise<CloudServer> = () => startCloud()): Promise<void> {
  let srv: CloudServer;
  try {
    srv = await start();
  } catch (err) {
    process.stdout.write(JSON.stringify({ severity: 'ERROR', message: 'cloud_start_failed', time: new Date().toISOString(), err: { name: (err as Error).name, message: (err as Error).message } }) + '\n');
    process.exit(1);
  }
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    srv.log.info('signal', { signal });
    srv.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('unhandledRejection', (err) => srv.log.error('unhandled_rejection', { err: err as Error }));
}

const isMain = process.argv[1] && /main\.(ts|js|mjs)$/.test(process.argv[1]);
if (isMain) void runCloud();
