// Recovery: set (or create) a login's passphrase, directly on the machine running the engine.
// There is deliberately no "forgot passphrase" link: access to this machine is the proof.
//   node bin/set-passphrase.ts <username>            (asks for the new passphrase, hidden)
// Every existing session of that login is signed out.
import path from 'node:path';
import readline from 'node:readline';
import { AppDb } from '../src/app/appDb.ts';
import { Auth } from '../src/app/auth.ts';

const identifier = process.argv[2];
if (!identifier) {
    console.error('usage: set-passphrase.ts <username>');
    process.exit(1);
}
const dataDir = process.env.DATA_DIR ?? path.resolve(import.meta.dirname, '../data');

/** Reads a line without echoing it when attached to a terminal; reads plain stdin otherwise. */
function ask(prompt: string): Promise<string> {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
        if (process.stdin.isTTY) {
            process.stdout.write(prompt);
            (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {}; // hide typing
        }
        rl.question(process.stdin.isTTY ? '' : '', answer => {
            rl.close();
            if (process.stdin.isTTY) process.stdout.write('\n');
            resolve(answer);
        });
    });
}

const first = await ask('New passphrase: ');
const second = process.stdin.isTTY ? await ask('Again: ') : first;
if (first !== second) {
    console.error('The two entries differ; nothing changed.');
    process.exit(1);
}
const app = new AppDb(path.join(dataDir, 'app.sqlite'));
try {
    const result = await new Auth(app).setPassphrase(identifier, first);
    console.log(result === 'created' ? `Login "${identifier}" created.` : `Passphrase for "${identifier}" changed; all its sessions were signed out.`);
} catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
} finally {
    app.close();
}
