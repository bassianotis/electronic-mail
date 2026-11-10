// The one script an email's frame runs (MailFrame.tsx), loaded from Mail's own address: the page's
// content policy, which the frame inherits, allows no inline script, and the frame's own policy
// allows exactly this file. It runs in the frame's opaque origin and only talks to the page by
// postMessage: the body's height and where the paper sheet starts, when its images have loaded (one
// that fails gets its placeholder back, by the rule in utils/remoteImages.ts), and Escape and the
// arrow keys (the reading view's shortcuts).
(function(){
var root=document.getElementById('em-root');
function post(m){m.em='mail-frame';parent.postMessage(m,'*');}
function size(){var r=root.getBoundingClientRect();var h=r.bottom+window.scrollY+(parseFloat(getComputedStyle(root).marginBottom)||0)+(Number(root.getAttribute('data-extra'))||0);var de=document.documentElement;if(de.scrollWidth>de.clientWidth){h+=window.innerHeight-de.clientHeight;}post({type:'size',height:Math.ceil(h),left:Math.round(r.left)});}
if(window.ResizeObserver){new ResizeObserver(size).observe(root);}
window.addEventListener('load',size);
size();
document.addEventListener('keydown',function(e){if(e.key==='Escape'||e.key.indexOf('Arrow')===0){post({type:'key',key:e.key});}});
if(root.getAttribute('data-images')!=='1')return;
var tpl=document.getElementById('em-ph');
function name(u){for(var d=0;d<3&&u;d++){var p;try{p=decodeURIComponent(new URL(u,'https://x.invalid').pathname.split('/').filter(Boolean).pop()||'');}catch(e){return '';}if(!/^https?:\/\//i.test(p))return p;u=p;}return '';} // the file name, unwrapped as fileNameOf does (remoteImages.ts)
function swap(img){var ph=tpl.content.firstElementChild.cloneNode(true);var w=Number(img.getAttribute('width'))||0,h=Number(img.getAttribute('height'))||0;var alt=img.getAttribute('alt')||'',file=name(img.getAttribute('src'));var box=w>=120&&h>=120;var label;if(box){ph.style.width=w+'px';ph.style.aspectRatio=w+' / '+h;label=root.getAttribute('data-look')==='paper'?alt:(file||alt);}else{ph.classList.add('em-chip');var svg=ph.querySelector('svg');if(svg){svg.setAttribute('width','14');svg.setAttribute('height','14');}if(w&&w<96){ph.classList.add('em-chip-icon');ph.style.width=Math.max(w,20)+'px';if(h)ph.style.height=Math.max(h,20)+'px';label='';}else{if(w)ph.style.maxWidth='min(100%, '+w+'px)';label=file||alt;}}if(alt||file){ph.setAttribute('aria-label',"Image didn't load: "+(alt||file));}if(label){var s=document.createElement('span');s.className='em-ph-label';s.textContent=label;ph.appendChild(s);}img.replaceWith(ph);}
var imgs=[].slice.call(root.querySelectorAll('img')).filter(function(i){return !/^data:/i.test(i.getAttribute('src')||'');});
var left=imgs.length,failed=0,sent=false;
function done(){if(sent)return;sent=true;post({type:'images',failed:failed});}
if(!left){done();return;}
setTimeout(done,10000);
imgs.forEach(function(img){var fin=function(ok){if(!ok){failed++;swap(img);}left--;if(left===0)done();};if(img.complete){fin(img.naturalWidth>0);}else{img.addEventListener('load',function(){fin(true);});img.addEventListener('error',function(){fin(false);});}});
})();
