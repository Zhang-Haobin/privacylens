import { readFile,writeFile,copyFile } from 'node:fs/promises';
import { qaDependency } from './dependencies.mjs';
const sharp=qaDependency('sharp');
const [id,file]=process.argv.slice(2); if(!id||!file)throw new Error('Usage: verify-browser.mjs fixture-id /absolute/download.png');
const suffix=process.argv[4]?`-${process.argv[4]}`:'';
const root=new URL('./',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('generated/annotations.json',root)));
const sample=manifest.images.find(image=>image.id===id);if(!sample)throw new Error('Unknown fixture');
const source=await sharp(new URL(`generated/${id}.png`,root).pathname).ensureAlpha().raw().toBuffer();
const {data:output,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
if(info.width!==sample.width||info.height!==sample.height)throw new Error('Export dimensions changed');
const isMask=offset=>output[offset]===32&&output[offset+1]===43&&output[offset+2]===36&&output[offset+3]===255;
const sensitive=sample.fields.map(field=>{
  const [x,y,w,h]=field.rect;let left=x+w,right=x,top=y+h,bottom=y;
  for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++){
    const offset=(py*sample.width+px)*4;
    if(source[offset]<140&&source[offset+1]<140&&source[offset+2]<140){left=Math.min(left,px);right=Math.max(right,px+1);top=Math.min(top,py);bottom=Math.max(bottom,py+1);}
  }
  let pixels=0,solid=0;
  // Check the entire tight ink rectangle, including its blank interior. Checking
  // text-colored pixels alone would mistake original dark glyphs for a mask.
  for(let py=top;py<bottom;py++)for(let px=left;px<right;px++){pixels++;solid+=isMask((py*sample.width+px)*4);}
  return {category:field.category,rect:[left,top,right-left,bottom-top],pixels,solid,fullyCovered:pixels>0&&solid===pixels};
});
const controls=sample.controls.map(control=>{
  const [x,y,w,h]=control.rect;let changed=0;
  for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++){
    const offset=(py*sample.width+px)*4;
    if([0,1,2,3].some(c=>Math.abs(source[offset+c]-output[offset+c])>1))changed++;
  }
  return {rect:control.rect,changedPixels:changed,unchanged:changed===0};
});
let unexpectedChanges=0,maskPixels=0;
for(let offset=0;offset<output.length;offset+=4){
  if(isMask(offset))maskPixels++;
  if([0,1,2,3].some(c=>Math.abs(source[offset+c]-output[offset+c])>1)&&!isMask(offset))unexpectedChanges++;
}
const png=await readFile(file),chunks=[];let offset=8;
while(offset<png.length){const length=png.readUInt32BE(offset);chunks.push(png.subarray(offset+4,offset+8).toString());offset+=length+12;}
const report={id,width:info.width,height:info.height,sensitive,controls,unexpectedChanges,maskPixels,chunks,noEmbeddedTextOrExif:!chunks.some(c=>['tEXt','zTXt','iTXt','eXIf'].includes(c))};
await copyFile(file,new URL(`results/browser-${id}${suffix}.png`,root));
await writeFile(new URL(`results/browser-${id}${suffix}-verification.json`,root),JSON.stringify(report,null,2));
console.log(JSON.stringify({id,full:sensitive.filter(f=>f.fullyCovered).length,total:sensitive.length,unchangedControls:controls.filter(c=>c.unchanged).length,controls:controls.length,unexpectedChanges,noEmbeddedTextOrExif:report.noEmbeddedTextOrExif}));
if(sensitive.some(f=>!f.fullyCovered)||controls.some(c=>!c.unchanged)||unexpectedChanges||!report.noEmbeddedTextOrExif)process.exitCode=1;
