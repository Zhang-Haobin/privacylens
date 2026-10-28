import { readFile,writeFile } from 'node:fs/promises';
import * as current from '../../dist/ocr-core.js';
import { classifyDocument } from '../../dist/document-context.js';
import { applyRecommendations } from '../../dist/sharing-context.js';
import * as before from '../../qa/technical-baseline/ocr-core.js';
import * as beforeContext from '../../qa/technical-baseline/document-context.js';
import * as beforePolicy from '../../qa/technical-baseline/sharing-context.js';
const reports=[];
for(const file of ['ocr-pipeline.json','context-holdout-documents.json']){
  const rows=JSON.parse(await readFile(new URL(`../ground-truth/runs/${file}`,import.meta.url)));
  for(const sample of rows){
    const document=sample.document;
    const build=(core,classification,policy)=>{
      const type=classification(document).type;
      const purpose={technical_screenshot:'technical_help',delivery:'share',transcript:'showcase',chat:'post',general:'share'}[type];
      return {type,fields:policy(core.suggestionsToFields(core.localSuggestions(document),document),{documentType:type,context:'public',purpose})};
    };
    const old=build(before,beforeContext.classifyDocument,beforePolicy.applyRecommendations),next=build(current,classifyDocument,applyRecommendations);
    const masks=next.fields.filter(f=>f.hidden).map(f=>f.rect);let lost=0;
    for(const field of old.fields.filter(f=>f.hidden)){
      const [x,y,w,h]=field.rect;
      for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)if(!masks.some(([nx,ny,nw,nh])=>px>=nx&&px<nx+nw&&py>=ny&&py<ny+nh))lost++;
    }
    reports.push({id:sample.id||sample.label,typeBefore:old.type,typeAfter:next.type,oldFields:old.fields.length,newFields:next.fields.length,lostCoveredPixels:lost});
  }
}
await writeFile(new URL('results/regression.json',import.meta.url),JSON.stringify(reports,null,2));
console.log(`${reports.length} prior OCR documents: ${reports.filter(r=>r.typeBefore===r.typeAfter).length} unchanged types; ${reports.reduce((n,r)=>n+r.lostCoveredPixels,0)} formerly covered pixels lost.`);
if(reports.some(r=>r.lostCoveredPixels||r.typeBefore!==r.typeAfter))process.exitCode=1;
