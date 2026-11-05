const base='https://perfume-six-mu.vercel.app';
const html = await (await fetch(base+'/?z='+Date.now())).text();
const css = (html.match(/href="([^"]+\.css)"/)||[])[1];
const mains = [...html.matchAll(/src="([^"]+\.js)"/g)].map(m=>m[1]).filter(s=>/main/i.test(s));
console.log('css', css);
if (css) {
  const c = await (await fetch(base+'/'+css.replace(/^\//,''))).text();
  console.log('bulk-chev', c.includes('bulk-chev'), '| ios bg', c.includes('#f2f2f7'), '| switch', c.includes('input[type=checkbox]'));
}
if (mains.length) {
  const j = await (await fetch(base+'/'+mains[0].replace(/^\//,''))).text();
  console.log('main', mains[0], '| Bulk pricing', j.includes('Bulk pricing'));
}
