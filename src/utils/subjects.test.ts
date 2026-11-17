// node --test (npm test): reply and forward subjects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forwardSubject, replySubject } from './subjects.ts';

test('"Re: " once; a message with no subject gets "Re:" alone, no space after (owner, Checkpoint C)', () => {
    assert.equal(replySubject('Roof estimate'), 'Re: Roof estimate');
    assert.equal(replySubject('Re: Roof estimate'), 'Re: Roof estimate');
    assert.equal(replySubject('RE: Roof estimate'), 'RE: Roof estimate');
    assert.equal(replySubject(''), 'Re:');
    assert.equal(replySubject('   '), 'Re:');
});

test('"Fwd: " once; with no subject, "Fwd:" alone', () => {
    assert.equal(forwardSubject('Roof estimate'), 'Fwd: Roof estimate');
    assert.equal(forwardSubject('Fw: Roof estimate'), 'Fw: Roof estimate');
    assert.equal(forwardSubject(''), 'Fwd:');
});
