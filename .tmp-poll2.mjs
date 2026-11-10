const base='https://perfume-six-mu.vercel.app';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
for (let i=0;i<4;i++){
  try {
    const html = await (await fetch(base+'/?t='+Date.now())).text();
    const js = (html.match(/src="([^"]*main[^"]*\.js)"/)||[])[1];
    if (!js) { console.log(i,'no js tag'); await sleep(30000); continue; }
    const code = await (await fetch(base+'/'+js.replace(/^\//,''))).text();
    const ok = code.includes('Referrals') && code.includes('placeholderMen30');
    console.log(i, js.split('/').pop(), 'Referrals', code.includes('Referrals'), 'placeholderMen30', code.includes('placeholderMen30'), ok?'LIVE':'pending');
    if (ok) break;
  } catch(e){ console.log(i,'err',e.message); }
  await sleep(35000);
}
