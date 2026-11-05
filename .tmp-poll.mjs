const base='https://perfume-six-mu.vercel.app';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
for (let i=0;i<5;i++){
  try {
    const html = await (await fetch(base+'/?v='+Date.now())).text();
    const css = (html.match(/href="([^"]+\.css)"/)||[])[1];
    const mains = [...html.matchAll(/src="([^"]+\.js)"/g)].map(m=>m[1]).filter(s=>/main/i.test(s));
    if (css) {
      const c = await (await fetch(base+'/'+css.replace(/^\//,''))).text();
      const j = mains.length ? await (await fetch(base+'/'+mains[0].replace(/^\//,''))).text() : '';
      const ok = c.includes('bulk-chev') && c.includes('#f2f2f7');
      console.log(i, css, 'chev', c.includes('bulk-chev'), 'iosBg', c.includes('#f2f2f7'), 'bulkOpen', j.includes('Bulk pricing'));
      if (ok) break;
    }
  } catch(e){ console.log(i, 'err', e.message); }
  await sleep(30000);
}
