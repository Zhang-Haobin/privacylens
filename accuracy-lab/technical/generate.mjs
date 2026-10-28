import { mkdir, writeFile } from 'node:fs/promises';
import { fixtures } from './fixtures.mjs';
import { qaDependency } from './dependencies.mjs';
const sharp=qaDependency('sharp');
const root=new URL('generated/',import.meta.url); await mkdir(root,{recursive:true});
const escape=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const manifest=[];
for(const sample of fixtures) {
  const width=1120,height=150+sample.rows.length*46, x=34, charWidth=12.6, fontSize=21;
  const text=sample.rows.map((row,index)=>`<text y="${110+index*46}" fill="#202b24" font-size="${fontSize}" font-family="monospace">${[...row].map((char,i)=>`<tspan x="${x+i*charWidth}">${escape(char)}</tspan>`).join('')}</text>`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fafbf8"/><rect width="100%" height="52" fill="#e5eddf"/><text x="34" y="32" font-size="17" font-family="sans-serif" fill="#284536">FICTIONAL TECHNICAL TEST / ${sample.id}</text>${text}<text x="34" y="${height-15}" font-size="12" fill="#657b5d">Synthetic data only. No usable credentials.</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(new URL(`${sample.id}.png`,root).pathname);
  const used=new Map();
  const annotate=(entry,category)=>{
    const value=typeof entry==='string'?entry:entry.value;
    const key=value, occurrence=used.get(key)||0;
    const candidates=sample.rows.flatMap((row,index)=>{const matches=[];let start=row.indexOf(value);while(start>=0){matches.push({index,start});start=row.indexOf(value,start+1);}return matches;});
    const match=candidates[occurrence]; if(!match) throw new Error(`Missing source annotation in ${sample.id}`);
    used.set(key,occurrence+1);
    return {category:category||entry.category,value,rect:[Math.floor(x+match.start*charWidth),110+match.index*46-23,Math.ceil(value.length*charWidth),28]};
  };
  const fields=sample.fields.map(f=>annotate(f)); used.clear(); const controls=sample.controls.map(f=>annotate(f,'public'));
  manifest.push({id:sample.id,type:sample.type,width,height,fields,controls});
}
await writeFile(new URL('annotations.json',root),JSON.stringify({protocol:'Source-authored sensitive substrings and public controls, placed on a fixed character grid before OCR. Regions are independent of OCR and detection; coverage measures original dark ink pixels inside these regions.',images:manifest},null,2));
console.log(`Generated ${manifest.length} fictional images with source-based independent annotations.`);
