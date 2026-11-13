// npm run db:reset — DELETE the database file and rebuild it with demo data. Development only.
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { config } from '../server/config.js';
if (config.isProd && !process.argv.includes('--force')) { console.error('Refusing to reset a production database without --force.'); process.exit(1); }
if (!process.argv.includes('--yes')) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`This permanently deletes ${config.dbPath}. Type "reset" to continue: `); rl.close();
  if (a.trim() !== 'reset') { console.log('Cancelled.'); process.exit(0); }
}
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + suffix, { force: true });
const { getDb, closeDb } = await import('../server/db/connection.js');
const { migrate } = await import('../server/db/migrate.js');
const { bootstrap } = await import('../server/db/bootstrap.js');
const { seedDemo } = await import('../server/db/seed.js');
const db = getDb(); migrate(db); bootstrap(db); seedDemo(db); closeDb();
console.log('Database reset and demo data loaded.');
