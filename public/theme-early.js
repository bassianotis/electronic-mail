// The chosen look, set before the first paint (no flash of Light when Dark is picked). A file of its
// own, not inline in index.html: the built screens' content policy runs no inline script.
try { if (localStorage.getItem('mail_theme') === 'dark') document.documentElement.dataset.theme = 'dark'; if (localStorage.getItem('mail_font') === 'inter') document.documentElement.dataset.font = 'inter'; if (localStorage.getItem('mail_drag') === 'new') document.documentElement.dataset.drag = 'new'; } catch (e) {}
