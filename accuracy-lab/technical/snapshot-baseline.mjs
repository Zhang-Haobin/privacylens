import { execFileSync } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
const ref=process.argv[2];if(!ref)throw new Error('Pass an explicit local Git revision.');
const destination=new URL('../../qa/technical-baseline/',import.meta.url);await mkdir(destination,{recursive:true});
const files=execFileSync('git',['ls-tree','-r','--name-only',ref,'dist'],{encoding:'utf8'}).trim().split('\n').filter(file=>/^dist\/[^/]+\.js$/.test(file));
for(const file of files)await writeFile(new URL(file.slice(5),destination),execFileSync('git',['show',`${ref}:${file}`]));
console.log(`Saved ${files.length} public JS source files from the explicit baseline revision.`);
