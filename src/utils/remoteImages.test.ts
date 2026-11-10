// Outside addresses (utils/remoteImages.ts): every spelling that would load from outside counts as
// outside, and only the message's own data: and cid: parts don't. `npm test` runs this; the full
// check, in a browser with the frame's content policy, is in the reading-view walk-through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssIsOutside, fileNameOf, isOutside, placeholderShape, srcsetUrls } from './remoteImages.ts';

const OUTSIDE = [
    'http://t.example/p.png',
    'https://t.example/p.png',
    '//t.example/p.png',
    '\\\\t.example/p.png',             // \\host/p.png
    'https:\\\\t.example/p.png',       // https:\\host/p.png
    '/\\t.example/p.png',              // /\host/p.png
    'ht\ttps://t.example/p.png',       // a tab inside the scheme
    'ht\ntps://t.example/p.png',       // a newline inside the scheme
    'h\r\nttps://t.example/p.png',
    'HtTpS://t.example/p.png',         // mixed case
    '  https://t.example/p.png',       // leading spaces
    '\u0000https://t.example/p.png',   // a control character in front
    'p.png',                           // relative: would load from wherever the page is
    '/p.png',
    'about:blank',
    'blob:https://t.example/x',
    'http://[bad',                     // unreadable counts as outside
];

test('every spelling that loads from outside counts as outside', () => {
    for (const url of OUTSIDE) assert.equal(isOutside(url), true, JSON.stringify(url));
});

test("the message's own parts, and no address at all, don't", () => {
    for (const url of ['data:image/png;base64,iVBORw0KGgo=', 'DATA:image/gif;base64,R0lG', ' data:image/png,x', 'cid:part1@example', null, undefined, '', '   ']) {
        assert.equal(isOutside(url), false, JSON.stringify(url));
    }
});

test('srcset is read like the browser reads it (a data: address may hold commas)', () => {
    assert.deepEqual(srcsetUrls('a.png 1x, b.png 2x'), ['a.png', 'b.png']);
    assert.deepEqual(srcsetUrls('data:image/png;base64,AAA,BBB 1x, https://t.example/b.png 2x'), ['data:image/png;base64,AAA,BBB', 'https://t.example/b.png']);
    assert.deepEqual(srcsetUrls('https://t.example/a.png,https://t.example/b.png'), ['https://t.example/a.png,https://t.example/b.png']);
    assert.deepEqual(srcsetUrls('  data:image/png;base64,AAA  '), ['data:image/png;base64,AAA']);
});

test('CSS: url(), image-set() and @import, escapes and all', () => {
    for (const css of [
        'background:url(https://t.example/a.png)',
        "background-image: url('//t.example/a.png')",
        'background:url("\\\\t.example/a.png")',
        'background:u\\72l(https://t.example/a.png)',       // an escaped "r"
        'background:url(ht\\74ps://t.example/a.png)',       // an escaped "t"
        'background-image:image-set("https://t.example/a.png" 1x)',
        '@import "https://t.example/s.css";',
        '@font-face{font-family:X;src:url(https://t.example/x.woff2)}',
        'background:url(p.png)',
    ]) assert.equal(cssIsOutside(css), true, css);
    for (const css of ['color:red', 'background:url(data:image/png;base64,AAA)', "background:url('cid:a@b')", '/* url(https://t.example/a.png) */ color:red', '']) {
        assert.equal(cssIsOutside(css), false, css);
    }
});

test('fileNameOf: the last part of the address, unwrapped when an image service carries the real one inside', () => {
    assert.equal(fileNameOf('https://images.example.com/news/hero-banner.png?w=600'), 'hero-banner.png');
    assert.equal(fileNameOf('https://cdn.example.com/image/fetch/w_1100,c_limit/https%3A%2F%2Fbucket.example.com%2Fpublic%2Fimages%2F5f1c2a9e_1100x220.png'), '5f1c2a9e_1100x220.png');
    assert.equal(fileNameOf('https://cdn.example.com/image/fetch/w_36/https%3A%2F%2Fexample.com%2Ficon%2FArrowUpRight%3Fv%3D4%26height%3D36'), 'ArrowUpRight');
    assert.equal(fileNameOf('https://proxy.example.com/fetch/https://real.example.com/a/photo.jpg'), 'photo.jpg');
    assert.equal(fileNameOf('https://example.com/'), '');
    assert.equal(fileNameOf(null), '');
});

test('placeholderShape: a box at the real size, else a chip no wider than the email made room for', () => {
    assert.deepEqual(placeholderShape(600, 300), { kind: 'box', width: 600, height: 300 });
    assert.deepEqual(placeholderShape(550, null), { kind: 'chip', width: 550 });
    assert.deepEqual(placeholderShape(18, 18), { kind: 'chip', width: 18, height: 18 });
    assert.deepEqual(placeholderShape(null, null), { kind: 'chip' });
});
