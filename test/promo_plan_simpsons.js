const fs=require('fs');const {Board}=require('/workspace/simpsons/web/sim/simpsons.js'),I=require('/workspace/simpsons/web/input.js'),SNAP=require('/workspace/simpsons/web/net/snap.js');
const m=new Board(require('/workspace/simpsons/test/roms.js')());
const C=+process.argv[2]||1500,END=+process.argv[3]||3500,SEED=+process.argv[4]||1;
if(SEED==1)fs.writeFileSync('/tmp/sp/s0.bin',Buffer.from(SNAP.pack(m.save())));
let f=0;const plan=[];const step=fi=>{f++;I.applyFrame(m,fi,0);m.runFrames(1);};
const en=p=>m.ram[0xa5b+0xc0*p],lv=p=>m.ram[0x9d1+8*p];
const pos=p=>{const r=m.ram,o=0x0a40+0xc0*p;return{s:r[o],x:(((r[o+12]<<8)|r[o+13])<<16>>16)-54,y:374-r[o+0x12]-r[o+0x17]};};
const sx=()=>m.vram[0x1a00]+256*m.vram[0x1a01];
let rnd=(SEED*2654435761)>>>0;const R=n=>{rnd=(Math.imul(rnd,1103515245)+12345)>>>0;return(rnd>>>8)%n;};
const ACT=[I.R|I.FIRE,I.R|I.FIRE,I.R,I.R,I.R|I.U,I.R|I.D,I.U|I.R|I.FIRE,I.D|I.R|I.FIRE,I.FIRE,I.U|I.FIRE,I.D|I.FIRE,I.R|I.JUMP,I.U,I.D,I.L|I.FIRE,0,I.L,I.R|I.JUMP|I.FIRE];
const fin=(acts,k,ff)=>{const fi=new Uint8Array(4);for(let s=0;s<4;s++){let a=acts[s];if((a&I.FIRE)&&((ff>>2)&1))a&=~I.FIRE;if((a&I.JUMP)&&k>4)a&=~I.JUMP;fi[s]=a;}return fi;};
while(f<C+120){const fi=new Uint8Array(4),k=f+1-C;for(let s=0;s<4;s++){if((k>=0&&k<4)||(k>=12&&k<16)||(k>=24&&k<28))fi[s]=I.COIN;if(k>=60+8*s&&k<64+8*s)fi[s]=I.START;}step(fi);plan.push(Array.from(fi));}
// wait until all 4 in play
while(f<C+1200){step(new Uint8Array(4));plan.push([0,0,0,0]);if([0,1,2,3].every(p=>pos(p).s===0xc0)&&f>C+400)break;}
const P0=f;console.log('play at',P0);
const CH=12,LA=48;let scr=0,last=sx();
const dsc=(a,b)=>{let d=(b-a+512)%512;return d>256?0:d;};
function score(acts){const st=m.save(),f0=f;let s=0,lx=sx(),ok=true;const e0=[0,1,2,3].map(en),l0=[0,1,2,3].map(lv);
 for(let k=0;k<CH+LA;k++){step(fin(k<CH?acts:acts.map(a=>a&~I.JUMP),k,f));const x=sx();s+=dsc(lx,x);lx=x;
  for(let p=0;p<4;p++){if(lv(p)<l0[p]||e0[p]-en(p)>5||(en(p)===0&&e0[p]>0)){ok=false;}}if(!ok)break;}
 const ps=[0,1,2,3].map(pos);let sp=0;for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)sp+=Math.min(40,Math.abs(ps[i].x-ps[j].x))+Math.min(30,Math.abs(ps[i].y-ps[j].y));
 const edge=ps.reduce((a,q)=>a+(q.x<16||q.x>250?25:0),0);const dmg=[0,1,2,3].reduce((a,p)=>a+Math.max(0,e0[p]-en(p)),0);
 m.load(st);f=f0;return ok?s*40+sp-edge-dmg*30:-1e9;}
let fails=0;
while(f<END){let best=null,bs=-1e9;for(let c=0;c<14;c++){const acts=[0,1,2,3].map(()=>ACT[R(ACT.length)]);const v=score(acts)+R(8);if(v>bs){bs=v;best=acts;}}
 if(bs<=-1e9){fails++;best=[0,1,2,3].map(()=>ACT[R(ACT.length)]);}
 for(let k=0;k<CH;k++){step(fin(best,k,f));plan.push(Array.from(fin(best,k,f-1)));const x=sx();scr+=dsc(last,x);last=x;}
 if(f%240<CH)console.log(f,'scr',scr,'fails',fails,[0,1,2,3].map(p=>{const q=pos(p);return q.x+','+q.y+'/'+en(p)+'/'+lv(p)}).join(' '));}
fs.writeFileSync(`/tmp/sp/plan_${SEED}.json`,JSON.stringify({C,P0,plan}));console.log('done',f,'scr',scr,'fails',fails);
