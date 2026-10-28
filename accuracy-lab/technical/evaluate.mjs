import { createWorker } from 'tesseract.js';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as current from '../../dist/ocr-core.js';
import { classifyDocument } from '../../dist/document-context.js';
import { applyRecommendations } from '../../dist/sharing-context.js';
import { qaDependency } from './dependencies.mjs';
const sharp=qaDependency('sharp'), root=new URL('./',import.meta.url), results=new URL('results/',root);
await mkdir(results,{recursive:true});
const annotation=JSON.parse(await readFile(new URL('generated/annotations.json',root)));
const replay=process.argv.includes('--replay');
let documents;
if(replay) documents=JSON.parse(await readFile(new URL('documents.json',results)));
else {
  const worker=await createWorker('eng',1,{langPath:fileURLToPath(new URL('../../dist/vendor/ocr/lang',root)),cachePath:fileURLToPath(results)});
  documents=[];
  try {for(const sample of annotation.images){
    const scale=Math.min(2,2600/Math.max(sample.width,sample.height),Math.sqrt(6_000_000/(sample.width*sample.height)));
    const inputWidth=Math.round(sample.width*scale),inputHeight=Math.round(sample.height*scale);
    const input=await sharp(new URL(`generated/${sample.id}.png`,root).pathname).resize(inputWidth,inputHeight).png().toBuffer(), pages=[];
    for(const mode of ['3','11']){await worker.setParameters({tessedit_pageseg_mode:mode});pages.push((await worker.recognize(input,{}, {blocks:true,text:true})).data);}
    documents.push({id:sample.id,document:current.makeDocument(pages,sample.width,sample.height,inputWidth,inputHeight)});
    console.log(`${sample.id}: OCR completed`);
  }}finally{await worker.terminate();}
  await writeFile(new URL('documents.json',results),JSON.stringify(documents));
}
let baseline;
try{baseline={core:await import('../../qa/technical-baseline/ocr-core.js'),context:await import('../../qa/technical-baseline/document-context.js'),policy:await import('../../qa/technical-baseline/sharing-context.js')};}catch{/* Optional pre-change snapshot, see README. */}
const totals={}; const reports=[];
for(const sample of annotation.images){
  const {document}=documents.find(d=>d.id===sample.id), input=await sharp(new URL(`generated/${sample.id}.png`,root).pathname).ensureAlpha().raw().toBuffer();
  const payload=current.textPayload(document), wireWords=new Map(payload.lines.flatMap(l=>l.words).map(w=>[w.id,w.text]));
  const secretScreening=sample.fields.filter(f=>f.category==='secret').map(f=>{
    const [x,y,w,h]=f.rect;
    const words=document.words.filter(word=>{const b=word.bbox;return Math.max(0,Math.min(x+w,b.x1)-Math.max(x,b.x0))*Math.max(0,Math.min(y+h,b.y1)-Math.max(y,b.y0))>Math.min(w*h,(b.x1-b.x0)*(b.y1-b.y0))*.2;});
    return {ocrWords:words.length,allScreened:words.length>0&&words.every(word=>/^\[SECRET_/.test(wireWords.get(word.id)))};
  });
  const report={id:sample.id,expectedType:sample.type,secretScreening,variants:{}};
  for(const [variant,impl] of Object.entries({current:{core:current,context:{classifyDocument},policy:{applyRecommendations}},...(baseline?{before:baseline}:{})})){
    const type=impl.context.classifyDocument(document).type;
    const purpose={technical_screenshot:'technical_help',delivery:'share',transcript:'showcase',chat:'post',general:'share'}[type];
    const fields=impl.policy.applyRecommendations(impl.core.suggestionsToFields(impl.core.localSuggestions(document),document),{documentType:type,context:'public',purpose});
    const masks=fields.filter(f=>f.hidden).map(f=>f.rect);
    const inside=(x,y,rect)=>x>=rect[0]&&x<rect[0]+rect[2]&&y>=rect[1]&&y<rect[1]+rect[3];
    const coverage=entry=>{
      let ink=0,covered=0,classified=0;
      const [x,y,w,h]=entry.rect;
      for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++){
        const offset=(py*sample.width+px)*4;
        if(input[offset]<140&&input[offset+1]<140&&input[offset+2]<140){ink++;if(masks.some(r=>inside(px,py,r)))covered++;if(fields.some(f=>f.category===entry.category&&inside(px,py,f.rect)))classified++;}
      }
      return {...entry,ink,coverage:ink?covered/ink:0,classificationCoverage:ink?classified/ink:0};
    };
    const sensitive=sample.fields.map(coverage),controls=sample.controls.map(coverage);
    const sum=totals[variant]||={images:0,typeCorrect:0,fields:0,full:0,partial:0,missed:0,correctCategory:0,controls:0,overmasked:0,secretFields:0,secretFull:0};
    sum.images++;sum.typeCorrect+=type===sample.type;sum.fields+=sensitive.length;
    for(const f of sensitive){if(f.coverage>=.995)sum.full++;else if(f.coverage>0)sum.partial++;else sum.missed++;sum.correctCategory+=f.classificationCoverage>=.995;if(f.category==='secret'){sum.secretFields++;sum.secretFull+=f.coverage>=.995;}}
    sum.controls+=controls.length;sum.overmasked+=controls.filter(c=>c.coverage>.05).length;
    report.variants[variant]={type,fields,sensitive,controls};
    // Offline reference rendering is distinct from the browser export check.
    const overlay=Buffer.from(`<svg width="${sample.width}" height="${sample.height}">${masks.map(([x,y,w,h])=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#202b24"/>`).join('')}</svg>`);
    await sharp(new URL(`generated/${sample.id}.png`,root).pathname).composite([{input:overlay}]).png().toFile(new URL(`${sample.id}-${variant}.png`,results).pathname);
  }
  reports.push(report);
}
await writeFile(new URL('evaluation.json',results),JSON.stringify({protocol:annotation.protocol,totals,reports},null,2));
console.log(JSON.stringify(totals,null,2));
