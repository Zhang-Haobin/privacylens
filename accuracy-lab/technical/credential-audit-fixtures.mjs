// Synthetic only. Never replace these with real credentials.
const token = 'FAKE_AUDIT_SECRET_8mQ7xP2';
const prefix = 'sk-proj-FAKEAuditPrefix1234567890';
const entry = (id, rows, sensitive, extra = {}) => ({ id, rows, sensitive, ...extra });
export const credentialAuditCases = [
  entry('labelled-control', [['API_KEY=',token]], [[0,1]]),
  entry('split-value', [['API_KEY=','FAKE_AUDIT_','SECRET_8mQ7xP2']], [[0,1],[0,2]]),
  entry('duplicated-control', [['API_KEY=',token],['echo',token]], [[0,1],[1,1]]),
  entry('fullwidth-colon', [['API_KEY：',token]], [[0,1]]),
  entry('fullwidth-equals', [['access_token＝',token]], [[0,1]]),
  entry('ocr-broken-label', [['API_KE','Y:',token]], [[0,2]]),
  entry('db-password-env', [['DB_PASSWORD=',token]], [[0,1]]),
  entry('unlabelled-prefix-after-command', [['echo',prefix]], [[0,1]]),
  entry('unlabelled-prefix-control', [[prefix]], [[0,0]]),
  entry('escaped-quoted-password', [[String.raw`password="prefix\"`,token,'"']], [[0,0],[0,1]]),
  entry('bearer-control', [['Bearer',token]], [[0,1]]),
  entry('lowercase-bearer', [['bearer',token]], [[0,1]]),
  entry('mixedcase-bearer', [['bEaReR',token]], [[0,1]]),
  entry('fullwidth-label-value', [['ＤＢ＿ＰＡＳＳＷＯＲＤ＝','ＦＡＫＥ＿Ｎｏｒｍａｌｉｚｅｄ＿７７']], [[0,1]]),
  entry('split-every-label-letter', [['A','P','I','_','K','E','Y',':',token]], [[0,8]]),
  entry('missing-assignment-fail-closed', [['DB_PASSWORD','???',token],['TypeError:','invalid','input']], [[0,2]], { keep:[[1,0],[1,1],[1,2]] }),
  entry('missing-value-next-region', [['API_KEY'],['strange!','secret$','fragment'],['Docs:','https://developer.mozilla.org']], [[1,0],[1,1],[1,2]], { keep:[[2,0],[2,1]] }),
  entry('unclosed-quoted-value', [['password="strange!',token],['more$','fragments!'],['Node.js','v22.9.0']], [[0,0],[0,1],[1,0],[1,1]], { keep:[[2,0],[2,1]] }),
  entry('quoted-label-inside-value', [['password="begin','API_KEY=inside','trailingSecret!"',';','status=ok']], [[0,0],[0,1],[0,2]], { keep:[[0,4]] }),
  entry('escaped-backslash-before-close', [[String.raw`password="FAKE_ends_in_slashes\\"`,';','status=ok']], [[0,0]], { keep:[[0,2]] }),
  entry('quoted-boundary-keeps-debug', [['password="FAKE_only_secret77"','status=ok','app.js:42']], [[0,0]], { keep:[[0,1],[0,2]] }),
  entry('normalization-length-map', [['ﬃ','API_KEY：',token,';','status=ok']], [[0,2]], { keep:[[0,0],[0,4]] }),
  entry('ocr-substituted-prefix', [['echo','sk-proj-FAKEAudi1PrefixI23456789O']], [[0,1]]),
  entry('ocr-long-dash-in-prefix', [['echo','sk-proj—-FAKEAudi1PrefixI23456789O']], [[0,1]]),
  entry('duplicate-fragmented', [['DB_PASSWORD=',token],['echo','FAKE_AUDIT_','SECRET_8mQ7xP2']], [[0,1],[1,1],[1,2]]),
  entry('shell-option', [['curl','--api-key',token]], [[0,2]]),
  entry('unknown-provider-prefix', [[token]], [], { limitation:true })
];
export function auditDocument(rows) {
  let n=0;
  const lines=rows.map((row,i)=>({id:`l${i+1}`,text:row.join(' '),words:row.map((text,j)=>({id:`w${++n}`,text,bbox:{x0:10+j*170,y0:10+i*40,x1:160+j*170,y1:35+i*40}}))}));
  return {width:2000,height:1400,lines,words:lines.flatMap(l=>l.words)};
}
export const auditEnv = { OPENAI_API_KEY:'synthetic-audit-key', OPENAI_BASE_URL:'https://mock.example/v1' };

export function payloadSafe(body, fixture, source) {
  const data=typeof body==='string'?JSON.parse(body):body;
  const lines=data.lines||JSON.parse(data.messages[1].content).lines;
  const words=new Map(lines.flatMap(l=>l.words).map(w=>[w.id,w.text]));
  const compact=lines.map(l=>l.words.map(w=>w.text).join('')).join('').normalize('NFKC');
  return fixture.sensitive.every(([r,c])=>{
    const original=source.lines[r].words[c];
    return /^\[SECRET_[A-Z_]+\d+\]$/.test(words.get(original.id))&&!compact.includes(original.text.normalize('NFKC'));
  });
}
