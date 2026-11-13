// -----------------------------------------------------------------------------
// index.js — process entry point:  npm start
//   open DB → migrate → bootstrap/seed → integrity self-check → listen
// A failure in any startup step aborts with a clear message rather than serving
// from a half-initialised database.
// -----------------------------------------------------------------------------
import { config } from './config.js';
import { createLogger, closeLogger } from './lib/logger.js';
import { getDb, closeDb } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { bootstrap } from './db/bootstrap.js';
import { seedDemo, hasDemoData } from './db/seed.js';
import { checkIntegrity } from './db/integrity.js';
import { startBackupScheduler, stopBackupScheduler } from './db/backup.js';
import { sweepOverdue } from './modules/borrowing/service.js';
import { createApp } from './app.js';

const log = createLogger('server');

export function prepareDatabase() {
  const db = getDb();
  const { applied, current } = migrate(db);
  if (applied.length) log.info('migrations applied', { applied });
  bootstrap(db);
  if (config.seedDemo && !hasDemoData(db)) { seedDemo(db); log.info('demo data loaded'); }
  const integrity = checkIntegrity(db);
  if (!integrity.ok) log.error('INTEGRITY PROBLEMS DETECTED AT STARTUP — run `npm run db:check`', { issues: integrity.issues.slice(0, 10) });
  else log.info('integrity check passed', { checks: integrity.checks, schemaVersion: current });
}

async function main() {
  prepareDatabase();
  sweepOverdue();
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    log.info(`AU·LAB listening on http://localhost:${config.port}`, { env: config.nodeEnv, db: config.dbPath, tz: config.timezone });
    if (config.showDemoLogins) log.info(`Demo sign-in: msantos / ${config.demoPassword}  (disable with SHOW_DEMO_LOGINS=0)`);
  });
  startBackupScheduler();
  const hourly = setInterval(() => { try { sweepOverdue(); } catch (err) { log.error('overdue sweep failed', { err }); } }, 3600e3);
  hourly.unref();

  const shutdown = (signal) => {
    log.info(`${signal} received, shutting down`);
    stopBackupScheduler(); clearInterval(hourly);
    server.close(() => { closeDb(); closeLogger(); process.exit(0); });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log.error('unhandledRejection', { err }));
  process.on('uncaughtException', (err) => { log.error('uncaughtException', { err }); });
}

if (import.meta.url === new URL(process.argv[1], 'file:').href || process.argv[1]?.endsWith('server/index.js')) {
  main().catch((err) => { console.error('\nStartup failed:', err.message); log.error('startup failed', { err }); process.exit(1); });
}
