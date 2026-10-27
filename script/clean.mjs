import{rmSync}from'node:fs';import{dirname,resolve,sep}from'node:path';import{fileURLToPath}from'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
for(const name of process.argv.slice(2)){
 if(!['.next','.open-next'].includes(name))throw new Error('Unknown generated build directory');
 const target=resolve(root,name);if(!target.startsWith(root+sep)||dirname(target)!==root)throw new Error('Build directory escaped project root');
 rmSync(target,{recursive:true,force:true});
}
