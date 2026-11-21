(function(){var D=window.KV_LD_I18N,c=new URL(location.href).searchParams.get('lang'),s=(Object.prototype.hasOwnProperty.call(D,c)?D[c]:D.en).split('|'),L=document.getElementById('kv-ld');
L.dir=s[9]||'ltr';if(D[c])L.lang=c;
if(s[8]){var n=L.querySelector('.kv-ld-name');n.textContent=s[8];n.hidden=false;L.querySelector('.kv-ld-wm').style.display='none'}
document.getElementById('kv-ld-label').textContent=s[0];document.getElementById('kv-ld-sub').textContent=s[1];
/* full-resolution logo = window.KV_LOGO_SRC (hardcoded in <script id="kv-assets">). The card stays invisible until it is fully decoded. */
var i=L.querySelector('.kv-ld-logo'),u=window.KV_LOGO_SRC,d=0;
function go(){if(d)return;d=1;L.classList.add('rdy');try{performance.mark('kv:logo')}catch(e){}}
if(!u){i.remove();go()}else{i.onload=go;i.onerror=function(){i.style.display='none';go()};i.src=u;if(i.decode)i.decode().then(go,function(){})}})();
