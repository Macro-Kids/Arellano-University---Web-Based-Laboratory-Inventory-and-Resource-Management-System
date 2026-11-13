// npm run db:migrate — apply pending schema migrations.
import { getDb, closeDb } from '../server/db/connection.js';
import { migrate } from '../server/db/migrate.js';
const r = migrate(getDb());
console.log(r.applied.length ? `Applied: ${r.applied.join(', ')}` : 'Database already up to date.', `(schema version ${r.current})`);
closeDb();
