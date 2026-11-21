function KVStars(canvas,o){ /* 1:1 port of the Canvas "Stars" layer (cvDefaultStars + cvStarField + cvStarSprite + cvDrawStars) with its default settings.
  Self-contained on purpose: it is stringified into a Web Worker (OffscreenCanvas 2D) so main-thread script work can never freeze it.
  The star count is fixed (o.count = the component's "Density (star count)"). */
 var ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return null;
 var N=128,CORE='#ffffff',GLOW='#8fb4ff',RAY='#ffffff',MAXN=o.count,sprites=[],W=2,H=2,cw=o.w||1,ch=o.h||1,scale=1,t0=0,last=0,fr=0,ms=0,dead=0,paused=0,first=1,
 raf=self.requestAnimationFrame?function(f){self.requestAnimationFrame(f)}:function(f){setTimeout(function(){f(performance.now())},16)};
 function rgb(h){var n=parseInt(h.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255]}
 function rgba(v,a){return'rgba('+v[0]+','+v[1]+','+v[2]+','+(+a.toFixed(3))+')'}
 function sprite(kind){ /* kind 0: halo + rays + core. kind 1: soft halo only (underlay of the big stars) */
  if(sprites[kind])return sprites[kind];
  var c=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(N,N):document.createElement('canvas');c.width=c.height=N;
  var g=c.getContext('2d'),m=N/2,G=rgb(GLOW),C=rgb(CORE),R=rgb(RAY),ga=Math.min(1,.85),halo=g.createRadialGradient(m,m,0,m,m,m);
  halo.addColorStop(0,rgba(G,ga));halo.addColorStop(.18,rgba(G,ga*.55));halo.addColorStop(.5,rgba(G,ga*.16));halo.addColorStop(1,rgba(G,0));g.fillStyle=halo;g.fillRect(0,0,N,N);
  if(kind===0){var len=m*Math.min(.98,.55),w=m*.035;
   for(var i=0;i<4;i++){g.save();g.translate(m,m);g.rotate(Math.PI*2*i/4-Math.PI/2);var lg=g.createLinearGradient(0,0,len,0);lg.addColorStop(0,rgba(R,.95));lg.addColorStop(1,rgba(R,0));
    g.fillStyle=lg;g.beginPath();g.moveTo(0,-w);g.lineTo(len,0);g.lineTo(0,w);g.closePath();g.fill();g.restore()}}
  var core=g.createRadialGradient(m,m,0,m,m,m*(kind===0?.2:.14));core.addColorStop(0,rgba(C,1));core.addColorStop(.45,rgba(C,.85));core.addColorStop(1,rgba(C,0));g.fillStyle=core;g.fillRect(0,0,N,N);
  return sprites[kind]=c}
 /* cvStarField(seed 7, n) */
 var f=new Float32Array(MAXN*6),s=(7*9301+49297)>>>0,rnd=function(){return(s=(s*1664525+1013904223)>>>0)/4294967296},i;
 for(i=0;i<MAXN;i++){f[i*6]=(rnd()-.5)*1e4;f[i*6+1]=(rnd()-.5)*1e4/1.7777;f[i*6+2]=rnd()*5000;f[i*6+3]=.75+rnd()*.5;f[i*6+4]=rnd()*6.2832;f[i*6+5]=rnd()}
 function fit(){var k=Math.min(1,Math.sqrt(1.6e6/(cw*ch)))*scale;W=Math.max(2,Math.round(cw*k));H=Math.max(2,Math.round(ch*k));if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H}}
 function draw(T,n){ /* cvDrawStars with density n, size 1, brightness 1, glow 1, rays 1, rayCount 4, bigEvery 20, speed 1, pulse .6, sway 1, roll 0, twinkle .25, twinkleSpeed 1 */
  var k=W/1920,focal=700*k,D=480*(T+.6*2*Math.sin(T/2)),ang=Math.sin(T/2)/2,ca=Math.cos(ang),sa=Math.sin(ang),o6,z,Zc,x,y,px,py,a,big,sz,s1,sp0=sprite(0),sp1=sprite(1);
  ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);ctx.translate(W/2,H/2);
  for(var j=0;j<n;j++){o6=j*6;z=f[o6+2]-D;z-=Math.floor(z/5000)*5000;Zc=z+50;x=f[o6]*ca+f[o6+1]*sa;y=f[o6+1]*ca-f[o6]*sa;px=x/Zc*focal;py=y/Zc*focal;
   a=Math.min(1,1/(1+Math.pow(Zc,20)/1e72)*Math.min(1,Zc/1e3)*4);if(a<.03)continue;
   big=j%20===0;sz=Math.min(1e4,2e5/Math.pow(Zc,1.25))*k*f[o6+3]*(big?1.5:1);
   if(Math.abs(px)>W/2+sz||Math.abs(py)>H/2+sz||sz<.4)continue;
   a*=1-.25*(.5+.5*Math.sin(T*6.2832+f[o6+4]));ctx.globalAlpha=a;
   if(big){s1=Math.min(1e4,5e5/Math.pow(Zc,1.25))*k/1.05;ctx.drawImage(sp1,px-s1/2,py-s1/2,s1,s1)}
   ctx.drawImage(sp0,px-sz/2,py-sz/2,sz,sz)}
  ctx.globalAlpha=1}
 function frame(now){if(dead)return;raf(frame);if(paused){last=0;return}if(!t0)t0=now;var T=(now-t0)/1000;
  draw(T,o.count);
  if(last&&++fr>10){ms+=now-last;if(fr===50){if(ms/40>24&&scale>.4){scale*=.85;fit()}fr=10;ms=0}}last=now;
  if(first){first=0;if(o.onready)o.onready()}}
 fit();raf(frame);
 return{size:function(w,h){cw=w;ch=h;fit()},pause:function(v){paused=v},stop:function(){dead=1}}
}
