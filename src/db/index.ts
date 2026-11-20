import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

const TRANSIENT_SQL_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  '57P01', // admin_shutdown (Cloud SQL scale-to-zero / restart)
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08003', // connection_does_not_exist
  '08006', // connection_failure
]);

function isTransientSqlError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { code?: string; message?: string };
  if (anyErr.code && TRANSIENT_SQL_CODES.has(anyErr.code)) return true;
  const msg = (anyErr.message || '').toLowerCase();
  return (
    msg.includes('connection terminated') ||
    msg.includes('connection closed') ||
    msg.includes('socket hang up') ||
    msg.includes('client has encountered a connection error')
  );
}

export const createPool = () => {
  if (!global._postgresPool) {
    const poolInstance = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      min: 0,
      max: 10,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 20000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      allowExitOnIdle: true,
    });

    // pg.Pool automatically evicts errored idle clients from the pool.
    // Cloud SQL Developer Edition suspends idle connections (scale-to-zero),
    // which triggers transient idle disconnects that should not crash or spam stderr.
    poolInstance.on('error', (err) => {
      if (isTransientSqlError(err)) {
        return;
      }
      console.error('SQL pool error:', err instanceof Error ? err.message : String(err));
    });

    // Retry a promise-based pool.query once when Cloud SQL wakes from scale-to-zero
    // or drops a stale pooled connection mid-handshake.
    const rawQuery = poolInstance.query.bind(poolInstance) as (...args: any[]) => any;
    (poolInstance as any).query = (...args: any[]) => {
      const hasCallback = typeof args[args.length - 1] === 'function';
      if (hasCallback) {
        return rawQuery(...args);
      }
      return Promise.resolve(rawQuery(...args)).catch(async (err) => {
        if (!isTransientSqlError(err)) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 250));
        return rawQuery(...args);
      });
    };

    global._postgresPool = poolInstance;
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
export { pool };
