import fs from 'node:fs';
const dir='dist/perfume-app/browser';
const css=fs.readdirSync(dir).find(f=>f.startsWith('styles-')&&f.endsWith('.css'));
const main=fs.readdirSync(dir).find(f=>f.startsWith('main-')&&f.endsWith('.js'));
const c=fs.readFileSync(dir+'/'+css,'utf8');
const j=fs.readFileSync(dir+'/'+main,'utf8');
console.log('built', css, main);
console.log('bulk-chev', c.includes('bulk-chev'), '| ios bg', c.includes('#f2f2f7'), '| switch', c.includes('input[type=checkbox]'), '| toggle', j.includes('bulkOpen'));
