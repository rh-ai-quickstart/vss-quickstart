// Source for rh_vss_architecture.png / .svg (the README architecture diagram).
// Renders the dev-profile-base deployment in the NVIDIA VSS blueprint style with
// Red Hat accents. To regenerate after editing:
//   npm i @resvg/resvg-js && node rh_vss_architecture.gen.js
// Writes out.svg / out.png in the cwd; copy over the .svg/.png here.
const fs = require('fs');
const { Resvg } = require('@resvg/resvg-js');

// ---- palette ----
const C = {
  green: '#76B900',   // NVIDIA NIM models
  gold:  '#F0AB00',   // services
  orange:'#E8622D',   // sources / ingest
  red:   '#EE0000',   // VSS agent (RH branded)
  teal:  '#009596',   // web UI
  blue:  '#0066CC',   // user / mlflow
  purple:'#8476D1',   // datastores
  frame: '#FAFAFA',
  frameBorder: '#B8BBBE',
  group: '#F0F0F0',
  groupBorder: '#B8BBBE',
  ink:   '#151515',
  gray:  '#6A6E73',
  white: '#FFFFFF',
};

const W = 1580, H = 930;
const S = []; // svg fragments
const push = (s) => S.push(s);

// ---- primitives ----
function rrect(x,y,w,h,rx,fill,stroke,sw){
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"`+
    (stroke?` stroke="${stroke}" stroke-width="${sw||1.5}"`:'')+`/>`;
}
function txt(x,y,s,{size=15,weight=400,fill=C.ink,anchor='middle',ff='Arial, Helvetica, sans-serif'}={}){
  return `<text x="${x}" y="${y}" font-family="${ff}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${s}</text>`;
}
// multiline centered label below a point
function labelLines(cx,y,lines,{size=14,weight=600,fill=C.ink,gap=16}={}){
  return lines.map((ln,i)=>txt(cx,y+i*gap,ln,{size,weight,fill})).join('');
}

// ---- glyphs (white on colored box) ----
function gGear(cx,cy,r,bg){
  let t='';
  for(let k=0;k<8;k++){t+=`<rect x="${cx-4}" y="${cy-r-6}" width="8" height="13" rx="2" fill="${C.white}" transform="rotate(${k*45} ${cx} ${cy})"/>`;}
  return t+`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.white}"/><circle cx="${cx}" cy="${cy}" r="${r*0.42}" fill="${bg}"/>`;
}
function gUser(cx,cy){
  return `<circle cx="${cx}" cy="${cy-11}" r="11" fill="${C.white}"/>`+
    `<path d="M ${cx-19} ${cy+22} a 19 17 0 0 1 38 0 z" fill="${C.white}"/>`;
}
function gMonitor(cx,cy){
  return rrect(cx-22,cy-18,44,30,3,C.white)+
    `<rect x="${cx-18}" y="${cy-14}" width="36" height="22" rx="2" fill="${C.teal}"/>`+
    `<rect x="${cx-6}" y="${cy+12}" width="12" height="6" fill="${C.white}"/>`+
    `<rect x="${cx-14}" y="${cy+18}" width="28" height="4" rx="2" fill="${C.white}"/>`;
}
function gAgent(cx,cy){ // hub of nodes
  const pts=[[0,-18],[-16,10],[16,10]];
  let l=pts.map(p=>`<line x1="${cx}" y1="${cy}" x2="${cx+p[0]}" y2="${cy+p[1]}" stroke="${C.white}" stroke-width="3"/>`).join('');
  let c=pts.map(p=>`<circle cx="${cx+p[0]}" cy="${cy+p[1]}" r="6" fill="${C.white}"/>`).join('');
  return l+c+`<circle cx="${cx}" cy="${cy}" r="9" fill="${C.white}"/>`;
}
function gPlay(cx,cy,bg){ // source / video
  return `<circle cx="${cx}" cy="${cy}" r="20" fill="${C.white}"/>`+
    `<path d="M ${cx-6} ${cy-9} L ${cx+11} ${cy} L ${cx-6} ${cy+9} z" fill="${bg}"/>`;
}
function gDB(cx,cy,bg){ // cylinder
  const w=30,h=26;
  return `<ellipse cx="${cx}" cy="${cy-h/2}" rx="${w/2}" ry="6" fill="${C.white}"/>`+
    `<rect x="${cx-w/2}" y="${cy-h/2}" width="${w}" height="${h}" fill="${C.white}"/>`+
    `<ellipse cx="${cx}" cy="${cy+h/2}" rx="${w/2}" ry="6" fill="${C.white}"/>`+
    `<ellipse cx="${cx}" cy="${cy-h/2}" rx="${w/2}" ry="6" fill="none" stroke="${bg}" stroke-width="2"/>`+
    `<ellipse cx="${cx}" cy="${cy-h/2+9}" rx="${w/2}" ry="6" fill="none" stroke="${bg}" stroke-width="2"/>`;
}
function gNet(cx,cy){ // model network node (white on green hex)
  const pts=[[-15,-6],[15,-6],[0,15]];
  let l=pts.map(p=>`<line x1="${cx}" y1="${cy}" x2="${cx+p[0]}" y2="${cy+p[1]}" stroke="${C.white}" stroke-width="2.5"/>`).join('');
  let c=pts.map(p=>`<circle cx="${cx+p[0]}" cy="${cy+p[1]}" r="5.5" fill="${C.white}"/>`).join('');
  return l+c+`<circle cx="${cx}" cy="${cy}" r="7" fill="${C.white}"/>`;
}
function gFunnel(cx,cy){
  return `<path d="M ${cx-16} ${cy-14} L ${cx+16} ${cy-14} L ${cx+4} ${cy+2} L ${cx+4} ${cy+16} L ${cx-4} ${cy+12} L ${cx-4} ${cy+2} z" fill="${C.white}"/>`;
}
function gPulse(cx,cy){
  return `<polyline points="${cx-18},${cy} ${cx-8},${cy} ${cx-3},${cy-13} ${cx+3},${cy+13} ${cx+8},${cy} ${cx+18},${cy}" fill="none" stroke="${C.white}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
}
function gBars(cx,cy){
  return `<rect x="${cx-16}" y="${cy-2}" width="8" height="16" fill="${C.white}"/>`+
    `<rect x="${cx-4}" y="${cy-14}" width="8" height="28" fill="${C.white}"/>`+
    `<rect x="${cx+8}" y="${cy-8}" width="8" height="22" fill="${C.white}"/>`;
}
function gFlask(cx,cy){
  return `<path d="M ${cx-5} ${cy-16} L ${cx-5} ${cy-4} L ${cx-15} ${cy+14} L ${cx+15} ${cy+14} L ${cx+5} ${cy-4} L ${cx+5} ${cy-16} z" fill="none" stroke="${C.white}" stroke-width="3" stroke-linejoin="round"/>`+
    `<line x1="${cx-8}" y1="${cy-16}" x2="${cx+8}" y2="${cy-16}" stroke="${C.white}" stroke-width="3" stroke-linecap="round"/>`+
    `<rect x="${cx-9}" y="${cy+4}" width="18" height="10" fill="${C.white}"/>`;
}

// ---- node (icon box) ----
function box(cx,cyIcon,fill,glyph,labels,{size=88,tag=null,lsize=14,lweight=600}={}){
  const h=size/2;
  let s=rrect(cx-h,cyIcon-h,size,size,14,fill);
  s+=glyph;
  if(tag){ s+=rrect(cx+h-30,cyIcon-h-9,34,18,9,C.ink)+txt(cx+h-13,cyIcon-h+4,tag,{size:11,weight:700,fill:C.white}); }
  s+=labelLines(cx,cyIcon+h+20,labels,{size:lsize,weight:lweight});
  return s;
}
function smallDB(cx,cy,label){
  const size=62,h=size/2;
  return rrect(cx-h,cy-h,size,size,12,C.purple)+gDB(cx,cy,C.purple)+txt(cx,cy+h+17,label,{size:13,weight:600});
}

// ---- hexagon model ----
const R=46;
function hexPts(cx,cy){
  let p=[];
  for(let i=0;i<6;i++){const a=Math.PI/180*(60*i);p.push([cx+R*Math.cos(a),cy+R*Math.sin(a)]);}
  return p.map(q=>`${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
}
function hexModel(cx,cy,labels,role){
  let s=`<polygon points="${hexPts(cx,cy)}" fill="${C.green}"/>`;
  s+=gNet(cx,cy-2);
  s+=labelLines(cx,cy+R*Math.sqrt(3)/2+18,labels,{size:13.5,weight:700});
  if(role){ // role chip above hex
    const cy2=cy-R*Math.sqrt(3)/2-16;
    s+=rrect(cx-22,cy2-9,44,18,9,C.ink)+txt(cx,cy2+4,role,{size:11.5,weight:800,fill:C.white});
  }
  return s;
}

// ---- arrows ----
function arrow(pts,{dashed=false,both=false,color=C.ink,label=null,lx=null,ly=null,lsize=12.5,sw=2.4}={}){
  const d='M '+pts.map(p=>`${p[0]} ${p[1]}`).join(' L ');
  let s=`<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}"`+
    (dashed?` stroke-dasharray="7 6"`:'')+
    ` marker-end="url(#ah${dashed?'d':''})"`+(both?` marker-start="url(#ah${dashed?'d':''})"`:'')+`/>`;
  if(label){
    const mx=lx!=null?lx:(pts[0][0]+pts[pts.length-1][0])/2;
    const my=ly!=null?ly:(pts[0][1]+pts[pts.length-1][1])/2;
    // white halo bg for readability
    s+=txt(mx,my,label,{size:lsize,weight:600,fill:C.gray});
  }
  return s;
}
// label with white background pill
function albl(x,y,s,{size=12.5,fill=C.gray}={}){
  const w=s.length*(size*0.56)+10;
  return rrect(x-w/2,y-size+2,w,size+6,4,C.white)+txt(x,y,s,{size,weight:600,fill});
}

// =========================================================
// BUILD
// =========================================================
push(`<rect width="${W}" height="${H}" fill="${C.white}"/>`);

// title
push(txt(W/2,42,'Video Search &amp; Summarization on Red Hat AI',{size:26,weight:800}));
push(txt(W/2,68,'dev-profile-base pipeline',{size:15,weight:500,fill:C.gray}));

// platform frame
const fx=210,fy=95,fw=1150,fh=800;
push(rrect(fx,fy,fw,fh,18,C.frame,C.frameBorder,1.6));
push(`<rect x="${fx}" y="${fy}" width="7" height="${fh}" rx="3" fill="${C.red}"/>`);
push(txt(fx+22,fy+26,'Red Hat AI Enterprise',{size:15,weight:800,fill:C.red,anchor:'start'}));

// lane divider
push(`<line x1="228" y1="512" x2="835" y2="512" stroke="${C.frameBorder}" stroke-width="1.4" stroke-dasharray="6 7"/>`);
push(txt(232,500,'QUERY / RESPONSE',{size:11.5,weight:700,fill:C.gray,anchor:'start'}));
push(txt(232,532,'INGESTION PIPELINE',{size:11.5,weight:700,fill:C.gray,anchor:'start'}));

// ---- groups (draw before nodes) ----
// model serving group
const mgx=852,mgy=250,mgw=190,mgh=560;
push(rrect(mgx,mgy,mgw,mgh,14,C.group,C.groupBorder,1.4));
push(txt(mgx+mgw/2,mgy+24,'Model Serving',{size:15,weight:800}));
// serving option chips
push(txt(mgx+mgw/2,mgy+mgh-84,'served via (choose one):',{size:10.5,weight:600,fill:C.gray}));
push(rrect(mgx+16,mgy+mgh-72,mgw-32,24,12,C.white,C.groupBorder,1.2));
push(txt(mgx+mgw/2,mgy+mgh-56,'KServe (on-cluster)',{size:11.5,weight:700,fill:C.ink}));
push(rrect(mgx+16,mgy+mgh-40,mgw-32,24,12,C.white,C.groupBorder,1.2));
push(txt(mgx+mgw/2,mgy+mgh-24,'NGC cloud',{size:11.5,weight:700,fill:C.ink}));

// observability group
const ogx=1075,ogy=250,ogw=270,ogh=500;
push(rrect(ogx,ogy,ogw,ogh,14,C.group,C.groupBorder,1.4));
push(txt(ogx+ogw/2,ogy+24,'Observability',{size:15,weight:800}));

// =========================================================
// NODES
// =========================================================
const TOP=320, BOT=660;

// user (outside frame)
push(box(110,TOP,C.blue,gUser(110,TOP-2),['User'],{size:82}));

// web UI
push(box(300,TOP,C.teal,gMonitor(300,TOP),['Web UI','(upload + chat)']));

// vss agent
push(box(500,TOP,C.red,gAgent(500,TOP),['VSS Agent','(orchestration)']));

// redis
push(smallDB(600,470,'Redis'));

// ingestion lane
push(box(300,BOT,C.orange,gPlay(300,BOT,C.orange),['Video Upload','/ Camera']));
push(box(475,BOT,C.gold,gGear(475,BOT,17,C.gold),['VST Ingress']));
push(box(645,BOT,C.gold,gGear(645,BOT,17,C.gold),['Sensor']));
push(box(795,BOT,C.gold,gGear(795,BOT,17,C.gold),['Stream','Processing'],{tag:'GPU'}));

// postgres (offset left so the connector clears the Stream Processing label)
push(smallDB(715,838,'Postgres'));

// models (hexagons in group)
push(hexModel(947,370,['e.g. Nemotron','Nano 9B'],'LLM'));
push(hexModel(947,630,['e.g. Cosmos3','Reasoner'],'VLM'));

// observability nodes — two independent chains
const oL=1128, oR=1292, oT=440, oB=560;
push(box(oL,oT,C.gold,gFunnel(oL,oT),['OTel','Collector'],{size:66,lsize:12}));
push(box(oR,oT,C.orange,gPulse(oR,oT),['Prometheus','(UWM)'],{size:66,lsize:12}));
push(box(oL,oB,C.blue,gFlask(oL,oB),['MLflow'],{size:66,lsize:12}));
push(box(oR,oB,C.teal,gBars(oR,oB),['Grafana'],{size:66,lsize:12}));

// =========================================================
// ARROWS
// =========================================================
// user <-> ui
push(arrow([[151,TOP],[259,TOP]],{both:true}));
// ui <-> agent
push(arrow([[344,TOP-12],[456,TOP-12]]));
push(arrow([[456,TOP+12],[344,TOP+12]]));
push(albl(400,TOP-20,'query'));
push(albl(400,TOP+30,'answer'));
// agent <-> redis (exit right edge, below summaries)
push(arrow([[544,362],[600,362],[600,439]],{both:true,sw:2}));
push(txt(615,412,'state',{size:12,weight:600,fill:C.gray,anchor:'start'}));
// agent -> vst ingress (exit left edge, routed left of label, crosses divider)
push(arrow([[456,352],[444,352],[444,600],[476,600],[476,617]],{}));
push(albl(444,540,'ingest'));
// ingestion flow
push(arrow([[344,BOT],[431,BOT]]));
push(arrow([[519,BOT],[601,BOT]]));
push(arrow([[689,BOT],[751,BOT]]));
// stream proc -> VLM (into model group)
push(arrow([[839,BOT],[903,634]],{}));
push(albl(874,632,'frames'));
// stream proc -> postgres (exit left edge, routed left of the label)
push(arrow([[751,690],[715,690],[715,807]],{both:true,sw:2}));
push(albl(700,752,'metadata'));
// VLM -> LLM (captions) routed left of the model-name labels
push(arrow([[947,590],[875,590],[875,370],[901,370]],{}));
push(albl(875,480,'captions'));
// agent <-> model serving group
push(arrow([[544,300],[852,322]],{}));
push(albl(700,290,'prompts'));
push(arrow([[852,352],[544,344]],{}));
push(albl(700,374,'summaries'));

// telemetry bus (dashed, no arrowhead) from agent + models up to observability
push(`<path d="M 500 276 L 500 212 L ${oR} 212" fill="none" stroke="${C.gray}" stroke-width="2.4" stroke-dasharray="7 6"/>`);
push(`<line x1="947" y1="250" x2="947" y2="212" stroke="${C.gray}" stroke-width="2.4" stroke-dasharray="7 6"/>`);
push(albl(715,206,'metrics &amp; traces'));
// bus drops into the two collectors
push(arrow([[oL,212],[oL,oT-33]],{dashed:true}));
push(arrow([[oR,212],[oR,oT-33]],{dashed:true}));
// internal chains, routed outside the labels: OTel -> MLflow, Prometheus -> Grafana
push(arrow([[oL-33,oT],[oL-42,oT],[oL-42,oB],[oL-33,oB]],{sw:2}));
push(arrow([[oR+33,oT],[oR+42,oT],[oR+42,oB],[oR+33,oB]],{sw:2}));

// =========================================================
// defs + assemble
// =========================================================
const defs=`<defs>
  <marker id="ah" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${C.ink}"/></marker>
  <marker id="ahd" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="${C.gray}"/></marker>
</defs>`;

const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${S.join('')}</svg>`;

fs.writeFileSync('rh_vss_architecture.svg', svg);
const r=new Resvg(svg,{fitTo:{mode:'width',value:W*2},font:{loadSystemFonts:true}});
fs.writeFileSync('rh_vss_architecture.png', r.render().asPng());
console.log('rendered', W*2,'x', Math.round(H*2));
