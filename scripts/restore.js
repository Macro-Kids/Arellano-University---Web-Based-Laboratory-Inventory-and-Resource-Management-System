// npm run db:restore -- <backup-file-name-or-path>
// STOP THE SERVER FIRST. The current database is saved aside before it is replaced.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { verifyBackup, listBackups } from '../server/db/backup.js';
const arg = process.argv[2];
if (!arg) { console.error('Usage: npm run db:restore -- <backup file>\nAvailable:\n' + listBackups().map((b) => '  ' + b.name).join('\n')); process.exit(1); }
const src = fs.existsSync(arg) ? path.resolve(arg) : path.join(config.backupDir, arg);
if (!fs.existsSync(src)) { console.error(`Not found: ${src}`); process.exit(1); }
const check = verifyBackup(src);
if (!check.verified) { console.error('Backup failed verification:', check.integrity); process.exit(1); }
if (fs.existsSync(config.dbPath)) {
  const aside = `${config.dbPath}.before-restore-${Date.now()}`;
  fs.copyFileSync(config.dbPath, aside); console.log(`Current database saved to ${aside}`);
}
for (const suffix of ['-wal', '-shm']) fs.rmSync(config.dbPath + suffix, { force: true });
fs.copyFileSync(src, config.dbPath);
console.log(`Restored ${path.basename(src)} (${check.items} items, ${check.users} users). Start the server again.`);
