// A consistent copy of Mail's durable data, for the nightly backup and before each ship:
// app.sqlite (SQLite's online backup, safe while the engine runs) and secret.key, which unlocks
// the account passwords in it (one is useless without the other). cache.sqlite is left out: it
// rebuilds itself from the mail server. The copy is checked before it counts.
//   node bin/backup.ts <into-folder>      DATA_DIR as for the engine
import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const dataDir = process.env.DATA_DIR ?? path.resolve(import.meta.dirname, '../data');
const into = process.argv[2];
if (!into) {
    console.error('usage: node bin/backup.ts <into-folder>');
    process.exit(1);
}
fs.mkdirSync(into, { recursive: true, mode: 0o700 });
const source = new DatabaseSync(path.join(dataDir, 'app.sqlite'), { readOnly: true });
await backup(source, path.join(into, 'app.sqlite'));
source.close();
fs.copyFileSync(path.join(dataDir, 'secret.key'), path.join(into, 'secret.key'));
for (const f of ['app.sqlite', 'secret.key']) fs.chmodSync(path.join(into, f), 0o600);
// One self-contained file (no write-ahead log beside it), then its check
const copy = new DatabaseSync(path.join(into, 'app.sqlite'));
copy.exec('PRAGMA journal_mode = DELETE');
const check = (copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
const { user_version: version } = copy.prepare('PRAGMA user_version').get() as { user_version: number };
copy.close();
if (check !== 'ok') {
    console.error(`backup in ${into} failed its check: ${check}`);
    process.exit(1);
}
console.log(`backed up app.sqlite (v${version}, checked) and secret.key to ${into}`);
