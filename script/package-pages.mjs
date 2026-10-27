import {cp,mkdir,writeFile} from 'node:fs/promises';
await mkdir('pages-dist',{recursive:true});
await cp('public/index.html','pages-dist/index.html');
for(const p of ['pages-demo','match-runtime-min','animal-cup']) await cp(`public/${p}`,`pages-dist/${p}`,{recursive:true});
await writeFile('pages-dist/.nojekyll','');
console.log('Static single-player match package is ready in pages-dist');
