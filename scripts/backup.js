// npm run db:backup — create and verify a backup now.
import { createBackup } from '../server/db/backup.js';
import { closeDb } from '../server/db/connection.js';
const b = await createBackup('cli');
console.log(`Backup ${b.name} (${(b.size / 1024).toFixed(0)} KB) — verified: ${b.verified}, items: ${b.items}, users: ${b.users}`);
closeDb();
if (!b.verified) process.exit(1);
