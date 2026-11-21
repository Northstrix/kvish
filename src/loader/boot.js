/* ============================ KVISH BOOT ENGINE ============================ (manifest.js explains how to extend; this file is inlined into production/index.html by `npm run build`)
   Order of events: first paint (this card) -> star field (worker) -> libraries + critical CSS in parallel -> app script -> React mount ->
   every hold released + first-screen fonts ready -> reveal. Nothing here is time based: it only waits for real "done" signals. */
__STARS__
(function(){
'use strict';
var d=document,root=d.documentElement,M=window.KV_BOOT_MANIFEST,DICT=window.KV_LD_I18N,P=new URL(location.href).searchParams,code=P.get('lang'),
 S=(Object.prototype.hasOwnProperty.call(DICT,code)?DICT[code]:DICT.en).split('|'),
 $=function(i){return d.getElementById(i)},L=$('kv-ld'),label=$('kv-ld-label'),detail=$('kv-ld-detail'),btn=$('kv-ld-btn'),rootEl=$('root'),
 manual=P.has('noAutoReveal')&&!/^(0|false)$/i.test(P.get('noAutoReveal')),noop=function(){},
 tasks=[],byId={},over=0,failed=0,mounted=0,revealed=0,fontsGaveUp=0,fontsTimer=0,stars=null,starsWorker=null,mo=null,pre=0;
function mark(n){try{performance.mark('kv:'+n)}catch(e){}}
function setBtn(t,fn){var e=btn.querySelectorAll('.fb-text');e[0].textContent=e[1].textContent=t;btn.onclick=fn}
function nameOf(u){try{return new URL(u,location.href).pathname.split('/').pop()||new URL(u,location.href).host}catch(e){return u}}
function add(id){var t=byId[id];if(!t){t={id:id,done:0};tasks.push(t);byId[id]=t}return t}
function finish(id){var t=byId[id];if(t&&!t.done){t.done=1;mark('done:'+id);sync()}}
function fontsBusy(){return!fontsGaveUp&&d.fonts&&d.fonts.status==='loading'}
function sync(){if(over||!mounted)return;
 for(var i=0;i<tasks.length;i++)if(!tasks[i].done)return;
 if(fontsBusy()){if(!fontsTimer){fontsTimer=setTimeout(function(){fontsGaveUp=1;sync()},8000);d.fonts.addEventListener('loadingdone',sync);d.fonts.addEventListener('loadingerror',sync)}return}
 over=1;mark('ready');if(mo)mo.disconnect();
 yieldPaint().then(function(){if(manual){label.textContent=S[2];setBtn(S[3],reveal);L.classList.add('ready');btn.focus({preventScroll:true})}else reveal()})}
function yieldPaint(){return new Promise(function(r){var f=function(){if(f.d)return;f.d=1;r()};requestAnimationFrame(function(){setTimeout(f)});setTimeout(f,150)})}
function hold(id){if(over||revealed)return noop;var t=add(id);t.done=0;return function(){finish(id)}}
function fail(kind,info,msg){if(failed||revealed)return;failed=1;over=1;mark('fail');console.error('[kv-boot]',kind,info&&info.src||'',msg||'');
 L.classList.add('fail');label.textContent=kind==='gl'?S[5]:kind==='net'?S[6].replace('{0}','\u2068'+nameOf(info.src)+'\u2069'):S[7];detail.textContent=kind==='net'||kind==='gl'?'':(msg||'');
 setBtn(S[4],function(){location.reload()});if(stars)stars.pause(true)}
addEventListener('error',function(e){if(failed||revealed||/^(chrome|moz|safari-web)-extension:/.test(e.filename||''))return;var gl=/webgl/i.test(e.message||'');if(gl||(!mounted&&!over))fail(gl?'gl':'err',null,e.message)});
/* ---------- public runtime API (documented in manifest.js) ---------- */
window.KV_BOOT={
 hold:hold,release:function(id){finish(id)},
 track:function(id,p){var r=hold(id);Promise.resolve(p).then(r,r);return p},
 watchRenderer:function(r,id){var rel=hold(id),o=r.render,once=0;r.render=function(){var x=o.apply(this,arguments);if(!once){once=1;r.render=o;requestAnimationFrame(function(){requestAnimationFrame(rel)})}return x}},
 mounted:function(){if(mounted)return;mounted=1;mark('mounted');finish('app');sync()},
 fail:function(m){fail('err',null,m)},
 state:function(){return{tasks:tasks.map(function(t){return t.id+(t.done?':done':':wait')}),mounted:mounted,over:over,revealed:revealed,failed:failed,lang:code||'en'}}
};
function probeGL(){var c=d.createElement('canvas'),g=c.getContext('webgl2')||c.getContext('webgl')||c.getContext('experimental-webgl');if(!g)return fail('gl');var e=g.getExtension('WEBGL_lose_context');if(e)e.loseContext()}
function css(href,cb){var l=d.createElement('link');l.rel='stylesheet';l.href=href;l.dataset.kv=1;l.onload=l.onerror=cb||null;d.head.appendChild(l)}
/* ---------- pipeline ---------- */
function prereq(id){pre--;finish(id);if(!pre)runApp()}
function start(){
 var crit=M.styles.filter(function(s){return s.critical});
 pre=M.scripts.length+crit.length;
 M.scripts.forEach(function(s){add(s.id)});crit.forEach(function(s){add(s.id)});add('app');
 var pl=d.createElement('link');pl.rel='preload';pl.as='script';pl.href=M.app.src;pl.dataset.kv=1;d.head.appendChild(pl);   /* download the app while the libraries run */
 crit.forEach(function(s){css(s.href,function(ev){if(ev.type==='error'&&s.required)return fail('net',{src:s.href});
  (d.fonts&&s.fonts&&s.fonts.length?Promise.all(s.fonts.map(function(f){return d.fonts.load(f)})):Promise.resolve()).catch(noop).then(function(){prereq(s.id)})})});
 M.scripts.forEach(function(s){var e=d.createElement('script');e.src=s.src;e.async=false;e.dataset.kv=1;
  e.onload=function(){if(s.global&&!window[s.global])return fail('lib',s,s.name+' did not initialise');prereq(s.id)};e.onerror=function(){fail('net',s)};d.head.appendChild(e)});
 yieldPaint().then(probeGL);
 if(!pre)runApp()}
function runApp(){if(failed)return;mark('libs');
 M.styles.forEach(function(s){if(!s.critical)css(s.href)});
 mo=new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n.nodeType!==1||(n.dataset&&n.dataset.kv))return;
  var u=n.tagName==='SCRIPT'?n.src:n.tagName==='LINK'&&/stylesheet/i.test(n.rel)?n.href:'';if(!u)return;var r=hold('res:'+u);n.addEventListener('load',r);n.addEventListener('error',r)})})});
 mo.observe(d.head,{childList:true});
 var e=d.createElement('script');e.src=M.app.src;e.dataset.kv=1;e.onload=function(){mark('app')};e.onerror=function(){fail('net',{src:M.app.src})};mark('run');d.head.appendChild(e)}
/* ---------- reveal: loader zooms out + blurs away while the app zooms in from blurred (exact opposite) ---------- */
function reveal(){if(revealed)return;revealed=1;mark('reveal');root.classList.remove('kv-boot');rootEl.removeAttribute('inert');
 var o={duration:720,easing:'cubic-bezier(.22,1,.36,1)'};L.style.pointerEvents='none';
 rootEl.animate([{opacity:0,transform:'scale(.94)',filter:'blur(14px)'},{opacity:1,transform:'none',filter:'blur(0)'}],o);
 L.animate([{opacity:1,transform:'none',filter:'blur(0)'},{opacity:0,transform:'scale(1.12)',filter:'blur(14px)'}],{duration:o.duration,easing:o.easing,fill:'forwards'}).onfinish=function(){
  if(stars)stars.stop();if(starsWorker)starsWorker.terminate();L.remove();mark('revealed')}}
/* ---------- star field: OffscreenCanvas in a Worker (immune to main-thread freezes); falls back to the main thread ---------- */
function startStars(){var cv=$('kv-ld-cv'),box=$('kv-ld-stars'),cfg={count:M.stars.count,w:box.clientWidth,h:box.clientHeight};
 function shown(){mark('stars');if(!box.animate)return box.classList.add('in');
  /* three simultaneous actions: scale 200% -> 100% (spring-like, tiny overshoot), opacity 0 -> 1, blur -> sharp */
  var a=box.animate([{transform:'scale(2)'},{transform:'scale(1)'}],{duration:300,fill:'both',easing:'cubic-bezier(.2,1.1,.3,1)'}),
      b=box.animate([{opacity:0,filter:'blur(24px)'},{opacity:1,filter:'blur(0)'}],{duration:300,fill:'both',easing:'cubic-bezier(.22,1,.36,1)'});
  b.onfinish=function(){box.classList.add('in');a.cancel();b.cancel()}}
 function wire(h){stars=h;addEventListener('resize',function(){h.size(box.clientWidth,box.clientHeight)});d.addEventListener('visibilitychange',function(){h.pause(d.hidden)})}
 function main(){var c=cv;if(c.dataset.t){c=c.cloneNode(false);cv.replaceWith(c);cv=c}cfg.onready=shown;var s=KVStars(c,cfg);if(s)wire(s)}
 if(window.OffscreenCanvas&&cv.transferControlToOffscreen&&window.Worker){try{
  var off=cv.transferControlToOffscreen();cv.dataset.t=1;
  var w=starsWorker=new Worker(URL.createObjectURL(new Blob(['var S;'+KVStars.toString()+';onmessage=function(e){var m=e.data;if(m.t==="i"){m.o.onready=function(){postMessage({t:"r"})};S=KVStars(m.c,m.o);if(!S)postMessage({t:"f"})}else if(S){if(m.t==="z")S.size(m.w,m.h);else if(m.t==="p")S.pause(m.v);else if(m.t==="s")S.stop()}}'],{type:'text/javascript'})));
  var fb=function(){if(!starsWorker)return;w.terminate();starsWorker=null;main()};
  w.onmessage=function(e){if(e.data.t==='r')shown();else if(e.data.t==='f')fb()};w.onerror=fb;w.postMessage({t:'i',c:off,o:cfg},[off]);
  wire({size:function(a,b){w.postMessage({t:'z',w:a,h:b})},pause:function(v){w.postMessage({t:'p',v:v})},stop:function(){w.postMessage({t:'s'})}})}catch(e){main()}}else main()}
mark('boot');startStars();start();
})();
