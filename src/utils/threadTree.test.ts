// node --test (npm test): the thread tree's shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DEPTH, threadTree } from './threadTree.ts';

const m = (msgKey: string, parentKey: string | null = null) => ({ msgKey, parentKey });
const shape = (rows: ReturnType<typeof threadTree>) => rows.map(r => `${'.'.repeat(r.depth)}${r.message.msgKey}${r.last ? '' : '+'}`);

test('each message under the one it answers; siblings in time order', () => {
    // The spec's board: 1 ← 2, 3; 2 ← 4; 3 ← 5, 6; 5 ← 7; 6 ← 8; 8 ← 9
    const rows = threadTree([m('1'), m('2', '1'), m('3', '1'), m('4', '2'), m('5', '3'), m('6', '3'), m('7', '5'), m('8', '6'), m('9', '8')]);
    assert.deepEqual(shape(rows), ['1', '.2+', '..4', '.3', '..5+', '...7', '..6', '...8', '....9']);
    // 7's ancestors: 1 (the only top-level row), 3 (the last child of 1), 5 (6 comes after it): a rail at level 2 only
    const seven = rows.find(r => r.message.msgKey === '7')!;
    assert.deepEqual(seven.rails, [false, false, true]);
});

test('a message whose parent isn\'t here is a top-level row, in time order', () => {
    assert.deepEqual(shape(threadTree([m('a'), m('b', 'gone'), m('c', 'a'), m('d')])), ['a+', '.c', 'b+', 'd']);
});

test('deeper than five levels stays at five', () => {
    const chain = Array.from({ length: 8 }, (_, i) => m(`m${i}`, i ? `m${i - 1}` : null));
    const rows = threadTree(chain);
    assert.deepEqual(rows.map(r => r.depth), [0, 1, 2, 3, 4, 5, 5, 5]);
    assert.ok(rows.every(r => r.rails.length === r.depth && r.depth <= MAX_DEPTH));
});

test('a loop of parents still lists every message once', () => {
    const rows = threadTree([m('x', 'y'), m('y', 'x'), m('z')]);
    assert.deepEqual(rows.map(r => r.message.msgKey).sort(), ['x', 'y', 'z']);
});
