// npm run db:check — verify data consistency (ledger vs quantity, assets vs status, requests vs releases…).
import { getDb, closeDb } from '../server/db/connection.js';
import { checkIntegrity } from '../server/db/integrity.js';
const r = checkIntegrity(getDb());
console.log(`${r.checks} checks run — ${r.ok ? 'ALL OK' : r.issues.length + ' PROBLEM(S)'}`);
for (const i of r.issues) console.log(` ✗ [${i.check}] ${i.message}`);
closeDb(); process.exit(r.ok ? 0 : 1);
