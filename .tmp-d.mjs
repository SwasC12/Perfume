import fs from 'node:fs';
const dir='dist/perfume-app/browser';
const js=fs.readdirSync(dir).filter(f=>f.startsWith('main-')&&f.endsWith('.js'));
const t=fs.readFileSync(dir+'/'+js[0],'utf8');
console.log('build', js[0], '| Referrals', t.includes('Referrals'), '| referralUses', t.includes('referralUses'));
