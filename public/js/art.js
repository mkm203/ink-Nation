/* Line-art generators: everything here is drawn in code, so the site looks finished before any photo is added.
   Each piece is replaced automatically by a real photo as soon as one is uploaded in the admin area. */
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  function el(n, a, p) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e }
  function rng(s) { return function () { s |= 0; s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
  /* ---------- line art generators ---------- */
  function petals(g,n,r0,r1,w,rot,attrs){
    var rm=(r0+r1)/2;
    for(var i=0;i<n;i++){
      var a=rot+i*360/n, p=el('path',{d:'M0 '+(-r0)+'Q'+w+' '+(-rm)+' 0 '+(-r1)+'Q'+(-w)+' '+(-rm)+' 0 '+(-r0)+'Z',transform:'rotate('+a+')'},g);
      for(var k in attrs)p.setAttribute(k,attrs[k]);
      if(i%2===0&&w>8){el('path',{d:'M0 '+(-r0-2)+'L0 '+(-r1+4),transform:'rotate('+a+')',opacity:.6},g)}
    }
  }
  function mandala(svg,opt){
    opt=opt||{};
    svg.setAttribute('viewBox','-100 -100 200 200');
    var base=opt.stroke||'currentColor', sw=opt.sw||.45;
    var root=el('g',{fill:'none',stroke:base,'stroke-width':sw,'stroke-linecap':'round'},svg);
    var outer=el('g',{'class':'spin-a'},root), inner=el('g',{'class':'spin-b'},root);
    el('circle',{r:97,'stroke-dasharray':'.6 2.4'},outer);
    el('circle',{r:94.5,'stroke-width':sw*.8},outer);
    for(var i=0;i<48;i++){var a=i*7.5*Math.PI/180;el('circle',{cx:Math.sin(a)*99.4,cy:-Math.cos(a)*99.4,r:.5,fill:base,stroke:'none'},outer)}
    petals(outer,24,70,93,6.5,0,opt.fillA?{fill:opt.fillA}:{});
    el('circle',{r:70},outer);
    petals(inner,16,47,71,10,11.25,opt.fillB?{fill:opt.fillB}:{});
    el('circle',{r:47},inner);
    petals(outer,12,27,48,10.5,0,opt.fillC?{fill:opt.fillC}:{});
    el('circle',{r:27,'stroke-dasharray':'2 1.2'},outer);
    petals(inner,8,9,28,7.5,22.5,opt.fillD?{fill:opt.fillD}:{});
    el('circle',{r:9},inner);el('circle',{r:3.4,fill:base},inner);
    return svg;
  }
  var GLYPH={
    diamond:'M0 -7L3.4 0L0 7L-3.4 0Z',
    cross:'M0 -7V7M-6 0H6M-3.4 -3.4L3.4 3.4M3.4 -3.4L-3.4 3.4',
    leaf:'M0 7Q6 0 0 -7Q-6 0 0 7ZM0 7V12',
    spiral:'M0 7C-6 7 -6 -1 0 -1C4 -1 4 4 1 4M0 7V12',
    arrow:'M0 -8V8M-3.6 -3.6L0 -8L3.6 -3.6M-3 5Q0 8 3 5',
    dot:'M-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'
  };
  function ornament(svg,seed){
    svg.setAttribute('viewBox','-340 -340 680 680');
    var rand=rng(seed||7);
    var g=el('g',{fill:'none',stroke:'currentColor','stroke-width':1.3,'stroke-linecap':'round','stroke-linejoin':'round'},svg);
    el('circle',{r:250},g);
    el('circle',{r:284,'stroke-dasharray':'30 14 5 14','stroke-width':1.6},g);
    el('circle',{r:300,'stroke-dasharray':'360 110 20 110','stroke-width':1},g);
    el('circle',{r:218,'stroke-dasharray':'1 7'},g);
    var order=['leaf','dot','cross','dot','spiral','dot','arrow','dot','diamond','dot'];
    for(var i=0;i<40;i++){
      var t=order[i%order.length];
      el('path',{d:GLYPH[t],transform:'rotate('+(i*9)+') translate(0 -267)',fill:t==='dot'?'currentColor':'none'},g);
    }
    for(var s=0;s<46;s++){
      var a=rand()*Math.PI*2, r=305+rand()*38, z=1.6+rand()*2.2;
      el('path',{d:'M0 '+(-z*1.7)+'Q0 0 '+(z*1.7)+' 0Q0 0 0 '+(z*1.7)+'Q0 0 '+(-z*1.7)+' 0Q0 0 0 '+(-z*1.7)+'Z',transform:'translate('+(Math.sin(a)*r)+' '+(-Math.cos(a)*r)+')',fill:'currentColor',stroke:'none'},g);
    }
  }
  function blossom(g,x,y,s,rot,fill,centre){
    var f=el('g',{transform:'translate('+x+' '+y+') rotate('+rot+') scale('+s+')'},g);
    for(var i=0;i<5;i++)el('path',{d:'M0 0C-15 -9 -13 -30 -3 -28L0 -23L3 -28C13 -30 15 -9 0 0Z',transform:'rotate('+(i*72)+')',fill:fill,stroke:'rgba(0,0,0,.25)','stroke-width':.8},f);
    el('circle',{r:3.2,fill:centre},f);
  }
  function irezumi(svg){
    var g=el('g',{},svg);
    el('circle',{cx:930,cy:270,r:112,fill:'#e3261c',opacity:.92},g);
    var bg='#1a2322', wv=el('g',{fill:bg,stroke:'#58a39b','stroke-width':1.6},g);
    var R=44;
    for(var row=0;row<26;row++){
      var y=575+row*R/2, off=row%2?R:0;
      if(y>900)break;
      for(var x=-R+off-100;x<1400;x+=R*2){
        el('circle',{cx:x,cy:y,r:R},wv);
        for(var k=1;k<=3;k++)el('circle',{cx:x,cy:y,r:R-k*9,fill:'none'},wv);
      }
    }
    el('path',{d:'M470 250C640 190 760 300 900 210S1120 150 1260 230',fill:'none',stroke:'#6b4a3a','stroke-width':5,'stroke-linecap':'round'},g);
    var pts=[[560,222,.9,20],[690,250,1.15,70],[820,262,.8,110],[930,200,1.25,160],[1060,170,.95,210],[1170,215,1.1,250],[740,330,.7,300],[1000,310,.85,330]];
    pts.forEach(function(p){blossom(g,p[0],p[1],p[2],p[3],'#ecd0cd','#c9564d')});
  }
  function rhodo(cx,cy,sc,n,d,rot,turns){
    var pts=[],steps=720,k=n/d;
    for(var i=0;i<=steps;i++){
      var th=i/steps*Math.PI*d*turns, r=Math.cos(k*th)*sc;
      var a=th+rot;
      pts.push((cx+r*Math.cos(a)).toFixed(1)+' '+(cy+r*Math.sin(a)).toFixed(1));
    }
    return 'M'+pts.join('L');
  }
  function rose(svg){
    var g=el('g',{fill:'none','stroke-linecap':'round','stroke-linejoin':'round'},svg);
    el('circle',{cx:850,cy:420,r:330,stroke:'#4a4a4a','stroke-width':1,'stroke-dasharray':'1 8'},g);
    var layers=[[300,5,3,0,'#8d8d8d',1.1],[245,5,3,.5,'#a2a2a2',1.1],[190,5,3,1.1,'#b6b6b6',1.2],[140,5,3,1.7,'#cfcfcf',1.3],[92,5,3,2.4,'#e4e4e4',1.4],[48,5,3,3,'#f0f0f0',1.5]];
    layers.forEach(function(L){el('path',{d:rhodo(850,420,L[0],L[1],L[2],L[3],1),stroke:L[4],'stroke-width':L[5],fill:'rgba(14,14,14,.55)'},g)});
    el('path',{d:rhodo(850,420,330,7,3,.2,1),stroke:'#5a5a5a','stroke-width':.8},g);
    for(var i=0;i<7;i++){var a=i*Math.PI*2/7+.3;el('path',{d:'M'+(850+Math.cos(a)*300)+' '+(420+Math.sin(a)*300)+'q'+(Math.cos(a)*50)+' '+(Math.sin(a)*50+30)+' '+(Math.cos(a)*90)+' '+(Math.sin(a)*90),stroke:'#6a6a6a','stroke-width':1},g)}
  }
  function colourMandala(svg){
    var holder=el('g',{transform:'translate(860 420) scale(3)'},svg);
    var inner=el('svg',{x:-100,y:-100,width:200,height:200,viewBox:'-100 -100 200 200',overflow:'visible'},holder);
    mandala(inner,{stroke:'#e2622c',sw:.5,fillA:'rgba(226,98,44,.28)',fillB:'rgba(47,160,150,.32)',fillC:'rgba(226,98,44,.4)',fillD:'rgba(240,200,120,.5)'});
  }
  function portrait(svg,kind,initial){
    var g=el('g',{},svg), c='#e1e1e1';
    if(kind==='mandala'){
      var h=el('g',{transform:'translate(150 150) scale(1.3)'},svg),i=el('svg',{x:-100,y:-100,width:200,height:200,viewBox:'-100 -100 200 200',overflow:'visible'},h);
      mandala(i,{stroke:'#7c7c7c',sw:.5});
    }else if(kind==='rose'){
      var gr=el('g',{fill:'none',stroke:'#8c8c8c','stroke-width':1},g);
      [[110,.0],[84,.5],[60,1.1],[38,1.7],[20,2.4]].forEach(function(L){el('path',{d:rhodo(150,150,L[0],5,3,L[1],1),fill:'rgba(10,10,10,.5)'},gr)});
    }else{
      var w=el('g',{fill:'#101010',stroke:'#5b5b5b','stroke-width':1},g);
      for(var row=0;row<9;row++)for(var x=-20+(row%2?24:0);x<340;x+=48){el('circle',{cx:x,cy:60+row*12,r:24},w);el('circle',{cx:x,cy:60+row*12,r:15,fill:'none'},w)}
      el('circle',{cx:215,cy:70,r:36,fill:'#e3261c',stroke:'none',opacity:.9},g);
    }
    var t=el('text',{x:16,y:382,'font-family':'Archivo, Helvetica, Arial, sans-serif','font-weight':900,'font-size':190,'letter-spacing':-10,fill:'none',stroke:c,'stroke-width':1.2,opacity:.85},svg);
    t.textContent=initial;
  }

  
  window.Art = { mandala: mandala, ornament: ornament, irezumi: irezumi, rose: rose, colourMandala: colourMandala, portrait: portrait };
})();
