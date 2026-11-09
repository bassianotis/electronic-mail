// The one script an email's frame runs (MailFrame.tsx), loaded from Mail's own address: the page's
// content policy, which the frame inherits, allows no inline script, and the frame's own policy
// allows exactly this file. It runs in the frame's opaque origin and only talks to the page by
// postMessage: the body's height, when its images have loaded (one that fails gets its placeholder
// back), and Escape and the arrow keys (the reading view's shortcuts).
(function(){
var root=document.getElementById('em-root');
function post(m){m.em='mail-frame';parent.postMessage(m,'*');}
function size(){var r=root.getBoundingClientRect();var h=r.bottom+window.scrollY+(parseFloat(getComputedStyle(root).marginBottom)||0)+(Number(root.getAttribute('data-extra'))||0);var de=document.documentElement;if(de.scrollWidth>de.clientWidth){h+=window.innerHeight-de.clientHeight;}post({type:'size',height:Math.ceil(h)});}
if(window.ResizeObserver){new ResizeObserver(size).observe(root);}
window.addEventListener('load',size);
size();
document.addEventListener('keydown',function(e){if(e.key==='Escape'||e.key.indexOf('Arrow')===0){post({type:'key',key:e.key});}});
if(root.getAttribute('data-images')!=='1')return;
var tpl=document.getElementById('em-ph');
function name(u){try{var p=new URL(u,'https://x.invalid').pathname.split('/').filter(Boolean).pop()||'';return decodeURIComponent(p);}catch(e){return '';}}
function swap(img){var ph=tpl.content.firstElementChild.cloneNode(true);var w=img.getAttribute('width'),h=img.getAttribute('height');ph.style.width=/^\d+$/.test(w||'')?w+'px':(img.offsetWidth>8?img.offsetWidth+'px':'100%');ph.style.height=/^\d+$/.test(h||'')?h+'px':'120px';var label=root.getAttribute('data-look')==='paper'?(img.getAttribute('alt')||''):(name(img.getAttribute('src'))||img.getAttribute('alt')||'');if(label){var s=document.createElement('span');s.className='em-ph-label';s.textContent=label;ph.appendChild(s);}img.replaceWith(ph);}
var imgs=[].slice.call(root.querySelectorAll('img')).filter(function(i){return !/^data:/i.test(i.getAttribute('src')||'');});
var left=imgs.length,failed=0,sent=false;
function done(){if(sent)return;sent=true;post({type:'images',failed:failed});}
if(!left){done();return;}
setTimeout(done,10000);
imgs.forEach(function(img){var fin=function(ok){if(!ok){failed++;swap(img);}left--;if(left===0)done();};if(img.complete){fin(img.naturalWidth>0);}else{img.addEventListener('load',function(){fin(true);});img.addEventListener('error',function(){fin(false);});}});
})();
