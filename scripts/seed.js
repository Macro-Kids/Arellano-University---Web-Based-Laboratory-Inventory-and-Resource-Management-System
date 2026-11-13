// npm run db:seed — load the demo dataset into an EMPTY database (creates + migrates it first).
import { getDb, closeDb } from '../server/db/connection.js';
import { migrate } from '../server/db/migrate.js';
import { bootstrap } from '../server/db/bootstrap.js';
import { seedDemo, hasDemoData } from '../server/db/seed.js';
const db = getDb();
migrate(db); bootstrap(db);
if (hasDemoData(db)) { console.error('Refusing to seed: this database already contains laboratories. Use `npm run db:reset` first.'); process.exitCode = 1; }
else { const r = seedDemo(db); console.log(`Demo data loaded. Integrity: ${r.ok ? 'OK' : 'PROBLEMS'} (${r.checks} checks).`); }
closeDb();
