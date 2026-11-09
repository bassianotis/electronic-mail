// Read-only preview of the engine's API. All email text is inserted with textContent;
// email HTML is shown only inside sandboxed iframes (no scripts, no same-origin, no remote
// loads), which is the rendering the real UI will use (docs/architecture.md, rule 10).
const API = '/api/v2';
const state = { account: null, folder: null, thread: null, offset: 0 };
const $ = sel => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
    }
    for (const c of children) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : String(c));
    return node;
}

async function get(path) {
    const res = await fetch(API + path);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
}

const enc = encodeURIComponent;
const fmtDate = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};
const shortName = path => path.replace(/^INBOX\./, '').replace(/^Buckets\./, '');

async function loadAccounts() {
    const { accounts } = await get('/accounts');
    const select = $('#account');
    select.replaceChildren(...accounts.map(a => el('option', { value: a.id }, a.email)));
    select.onchange = () => selectAccount(select.value);
    renderStatus(accounts);
    if (accounts.length) await selectAccount(accounts[0].id);
}

function renderStatus(accounts) {
    const a = accounts.find(x => x.id === state.account) ?? accounts[0];
    if (a) $('#status').textContent = `${a.email}: ${a.state}${a.error ? ` (${a.error})` : ''}`;
}

async function selectAccount(id) {
    state.account = id;
    state.folder = null;
    state.thread = null;
    $('#list').replaceChildren(el('div', { class: 'empty' }, 'Choose a folder.'));
    $('#detail').replaceChildren(el('div', { class: 'empty' }, 'Choose a conversation.'));
    await loadFolders();
    await openFolder('INBOX');
}

async function loadFolders() {
    const { folders } = await get(`/accounts/${enc(state.account)}/folders`);
    const groups = [['Inbox', ['inbox']], ['Buckets', ['bucket']], ['Archive', ['archive']], ['Other folders', ['other']], ['Sent & system', ['sent', 'drafts', 'junk', 'trash']]];
    const nav = $('#folders');
    nav.replaceChildren();
    for (const [title, roles] of groups) {
        const items = folders.filter(f => roles.includes(f.role) && !/\.Buckets$/.test(f.path));
        if (!items.length) continue;
        nav.append(el('h3', {}, title));
        for (const f of items) {
            nav.append(el('div', {
                class: 'folder' + (f.path === state.folder ? ' active' : ''),
                onclick: () => openFolder(f.path),
            }, el('span', {}, shortName(f.path)), el('span', { class: 'n' }, f.unreadThreads ? `${f.unreadThreads} / ${f.count}` : f.count)));
        }
    }
    nav.append(el('h3', {}, 'Views'), el('div', { class: 'folder' + (state.folder === '@sent' ? ' active' : ''), onclick: () => openFolder('@sent') }, el('span', {}, 'Sent conversations')));
}

async function openFolder(path, append = false) {
    state.folder = path;
    if (!append) state.offset = 0;
    const query = path === '@sent' ? 'view=sent' : `location=${enc(path)}`;
    const page = await get(`/accounts/${enc(state.account)}/threads?${query}&limit=50&offset=${state.offset}`);
    const list = $('#list');
    if (!append) {
        list.replaceChildren(el('div', { class: 'listhead' },
            `${path === '@sent' ? 'Sent conversations' : shortName(path)}: ${page.count} conversations, ${page.unreadThreads} unread`));
    }
    list.querySelector('.more')?.remove();
    for (const t of page.threads) {
        list.append(el('div', { class: 'card' + (t.threadId === state.thread ? ' active' : ''), 'data-thread': t.threadId, onclick: () => openThread(t.threadId) },
            el('div', { class: 'row' },
                t.unread ? el('span', { class: 'dot', title: 'unread' }) : null,
                el('span', { class: 'from' }, t.fromName || t.fromAddr || '(unknown sender)'),
                t.messageCount > 1 ? el('span', { class: 'badge' }, t.messageCount) : null,
                el('span', { class: 'date' }, fmtDate(t.latestDate))),
            el('div', { class: 'subject' }, t.subject || '(no subject)'),
            el('div', { class: 'preview' }, t.preview ?? '…')));
    }
    state.offset += page.threads.length;
    if (state.offset < page.count) list.append(el('button', { class: 'more', onclick: () => openFolder(path, true) }, `Show more (${page.count - state.offset} left)`));
    loadFolders();
}

async function openThread(threadId) {
    state.thread = threadId;
    document.querySelectorAll('.card').forEach(c => c.classList.toggle('active', c.dataset.thread === threadId));
    const { thread, messages } = await get(`/accounts/${enc(state.account)}/threads/${enc(threadId)}`);
    const detail = $('#detail');
    detail.replaceChildren(el('h2', {}, thread.subject || '(no subject)'),
        el('div', { class: 'note' }, `${messages.length} message${messages.length === 1 ? '' : 's'} in this conversation, oldest first. Click a message to open it.`));
    messages.forEach((m, i) => {
        const body = el('div', { class: 'body', hidden: '' });
        const box = el('div', { class: 'msg' },
            el('div', { class: 'meta', onclick: () => toggleBody(m, body) },
                m.seen ? null : el('span', { class: 'dot', title: 'unread' }),
                el('strong', {}, m.fromName || m.fromAddr || '(unknown)'),
                el('span', { class: 'date' }, m.date ? new Date(m.date).toLocaleString() : ''),
                el('span', { class: 'where' }, (m.sent ? 'sent by you · ' : '') + m.folders.map(f => shortName(f.path)).join(', '))),
            body);
        detail.append(box);
        if (i === messages.length - 1) toggleBody(m, body);
    });
}

async function toggleBody(m, container) {
    if (!container.hasAttribute('hidden')) { container.setAttribute('hidden', ''); return; }
    container.removeAttribute('hidden');
    if (container.dataset.loaded) return;
    container.replaceChildren(el('div', { class: 'note' }, 'Loading…'));
    try {
        const b = await get(`/accounts/${enc(state.account)}/messages/${enc(m.msgKey)}/body`);
        const parts = [];
        if (b.html) {
            const frame = el('iframe', { sandbox: '', referrerpolicy: 'no-referrer', title: 'Email content' });
            // CSP inside the frame: nothing remote loads (no tracking pixels), only inline images.
            frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">${b.html}`;
            parts.push(frame, el('div', { class: 'note' }, 'Remote images and links are blocked in this preview (by design).'));
        } else {
            parts.push(el('pre', {}, b.text ?? '(empty message)'));
        }
        if (b.attachments.length) {
            parts.push(el('div', { class: 'atts' }, 'Attachments:', ...b.attachments.map(a =>
                el('a', { href: `${API}/accounts/${enc(state.account)}/messages/${enc(m.msgKey)}/attachments/${a.part}` },
                    `${a.filename || a.contentType}${a.size ? ` (${Math.round(a.size / 1024)} KB)` : ''}`))));
        }
        if (b.listUnsubscribe) parts.push(el('div', { class: 'note' }, 'Has an unsubscribe link (one-click unsubscribe comes in a later phase).'));
        container.replaceChildren(...parts);
        container.dataset.loaded = '1';
    } catch (err) {
        container.replaceChildren(el('div', { class: 'note' }, `Could not load: ${err.message}`));
    }
}

// Live updates (JMAP-style): the engine pushes a new state; refresh what is on screen.
let refreshTimer = null;
const events = new EventSource(`${API}/events`);
events.addEventListener('state', e => {
    const { changed } = JSON.parse(e.data);
    if (!state.account || !changed[state.account] || refreshTimer) return;
    refreshTimer = setTimeout(async () => {
        refreshTimer = null;
        if (state.folder) await openFolder(state.folder);
    }, 800);
});
events.addEventListener('status', async () => renderStatus((await get('/accounts')).accounts));

get('/info').then(info => { if (info.label) $('#label').textContent = info.label; }).catch(() => {});
loadAccounts().catch(err => { $('#list').replaceChildren(el('div', { class: 'empty' }, `Engine not reachable: ${err.message}`)); });
