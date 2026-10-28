export const documentTypes = {
  delivery: { label: 'Delivery / order', purposes: ['share', 'advice', 'lookup', 'return', 'custom'], audiences: ['public', 'circle', 'team', 'support'] },
  transcript: { label: 'Academic transcript', purposes: ['showcase', 'job', 'submission', 'custom'], audiences: ['public', 'circle', 'organization'] },
  chat: { label: 'Chat conversation', purposes: ['post', 'advice', 'report', 'custom'], audiences: ['public', 'circle', 'team', 'organization'] },
  technical_screenshot: { label: 'Technical screenshot', purposes: ['technical_help', 'software_support', 'team_debug', 'custom'], audiences: ['public', 'support', 'team'] },
  general: { label: 'General / other', purposes: ['share', 'advice', 'submit', 'custom'], audiences: ['public', 'circle', 'team', 'organization'] }
};
export const purposeRegistry = {
  technical_help: { label: 'Ask for technical help online', keep: 'Error messages, software versions, relevant stack frames and line numbers.' },
  software_support: { label: 'Contact software support', keep: 'The error code, software version and relevant diagnostic details. Review any requested account identifier.' },
  team_debug: { label: 'Debug with colleagues', keep: 'Useful stack frames, method names, versions and relevant project context. Review internal network details.' },
  share: { label: 'Share an update', keep: 'The relevant update, status and dates.' },
  advice: { label: 'Ask for advice', keep: 'The question and enough non-private context to help.' },
  lookup: { label: 'Find an order or delivery', keep: 'The delivery status and relevant dates.' },
  return: { label: 'Request a return or refund', keep: 'The item, issue and relevant purchase information.' },
  showcase: { label: 'Showcase academic achievements', keep: 'The university, courses, grades and GPA.' },
  job: { label: 'Apply for a job or internship', keep: 'Relevant academic qualifications. Confirm what the recipient requires.' },
  submission: { label: 'Submit academic records', keep: 'Required academic records. Check whether a redacted copy is accepted.' },
  post: { label: 'Share a conversation publicly', keep: 'The non-private messages needed to explain the story.' },
  report: { label: 'Report harassment or misconduct', keep: 'Relevant messages and timing. Review identities before including them.' },
  submit: { label: 'Submit to an organization', keep: 'Only the content requested by the recipient.' },
  custom: { label: 'Other / describe my purpose', keep: 'Review which information is needed for your custom purpose.' }
};
export function purposesFor(type) { return (Object.hasOwn(documentTypes, type) ? documentTypes[type] : documentTypes.general).purposes; }

// Transparent keyword groups: no probability claims, filenames or remote calls.
export function classifyDocument(document) {
  const text = (document?.lines || []).map(line => line.text).join('\n').normalize('NFKC').replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '');
  const groups = {
    technical_screenshot: [
      [/(?:^|\n)\s*(?:(?:[\w.]+)?(?:TypeError|ReferenceError|SyntaxError|NullPointerException|\w+Exception)(?:\s*:|\b)|Traceback\s*\(most recent call last\))/im, 'An exception or traceback'],
      [/(?:^|\n)\s*(?:at\s+[\w.$<>]+\s*\([^\n]*:\d+\)?|File\s+["'][^\n]+["'],?\s+line\s+\d+)/im, 'A stack frame with a file and line number'],
      [/(?:^|\n)\s*(?:[$>]\s*)?(?:npm\s+(?:run|install|start|test)|pip\s+install|(?:node|python\d?|java|curl)\s+\S+)/im, 'A terminal command'],
      [/(?:^|\n)\s*(?:Error\s*:|npm\s+(?:ERR!|error)|(?:GET|POST|HTTP)\s+[^\n]*(?:401|403|500)|Failed to fetch\b|Connection refused\b|Permission denied\b)/im, 'A diagnostic error line'],
      [/(?:^|\n)\s*(?:export\s+)?(?:API[\s_-]*KEY|ACCESS[\s_-]*TOKEN|CLIENT[\s_-]*SECRET|DATABASE_URL|Authorization)\s*[:=]/im, 'A technical configuration or authorization label'],
      [/\b(?:Node\.js\s+v?\d+\.\d+|Python\s+\d+\.\d+|Java\s+(?:version\s+)?\d+|Chrome\/\d+|npm\s+v?\d+\.\d+)/i, 'A named software runtime version']
    ],
    transcript: [
      [/academic\s+transcript|transcript\s+of\s+(?:academic\s+)?record|成績單|成绩单/i, 'An academic transcript heading'],
      [/\b(?:c?gpa|grade\s+point\s+average)\b|平均績點|平均绩点/i, 'GPA terminology'],
      [/student\s*(?:id|number)|學號|学号/i, 'A student identifier label'],
      [/\b(?:course|credits|semester|grades?)\b|課程|课程|學分|学分/i, 'Course or grade terminology']
    ],
    delivery: [
      [/order\s*(?:details?|number|no\.?|#)|訂單|订单/i, 'Order heading or identifier'],
      [/order\s*(?:date|placed)|purchase\s*(?:date|details?)|下單日期|下单日期/i, 'Order or purchase date'],
      [/(?:shipping|delivery)\s+address|收貨地址|收货地址|送貨地址|送货地址/i, 'Shipping address label'],
      [/order\s*(?:total|amount)|total\s*(?:paid|payment)|訂單總額|订单总额/i, 'Order total label'],
      [/\b(?:delivery|tracking|waybill|in\s+transit|delivered)\b|運單|运单|物流|快遞|快递/i, 'Delivery or tracking terminology'],
      [/\b(?:parcel|shipment|recipient)\b|包裹|收件/i, 'Parcel or recipient terminology']
    ],
    chat: [
      [/whatsapp|demochat|chat\s+conversation|聊天記錄|聊天记录/i, 'A chat application or conversation heading'],
      [/\b(?:sent|delivered|read|last\s+seen|typing)\b|已讀|已读|在線|在线/i, 'Message status terminology'],
      [/(?:^|\n)\s*(?:\[?\d{1,2}:\d{2}\]?\s*){1,2}(?:am|pm)?\b/im, 'Chat-style timestamps']
    ]
  };
  const ranked = Object.entries(groups).map(([type, rules]) => ({ type, evidence: rules.filter(([rule]) => rule.test(text)).map(([, label]) => label) })).sort((a, b) => b.evidence.length - a.evidence.length);
  const first = ranked[0];
  if (!text.trim() || first.evidence.length < 2 || first.evidence.length === ranked[1].evidence.length) {
    return { type: 'general', source: 'local', reason: text.trim() ? 'No clear single type in the local text. Choose a type if you know it.' : 'No readable text available. Choose a type or scan locally.', evidence: [] };
  }
  return { type: first.type, source: 'local', reason: `Suggested from local text: ${first.evidence.join('; ')}. You can correct this.`, evidence: first.evidence };
}

// Derive a cautious type suggestion from the AI's classified OCR fields.
// The classification itself never changes document type or mask visibility.
export function suggestTypeFromAI(fields) {
  const hasIndependent = (left, right) => fields.some(a => left.includes(a.category) && Array.isArray(a.wordIds) && a.wordIds.length && fields.some(b => right.includes(b.category) && Array.isArray(b.wordIds) && b.wordIds.length && !a.wordIds.some(id => b.wordIds.includes(id))));
  const candidates = [];
  if (hasIndependent(['order'], ['tracking']) || hasIndependent(['order', 'tracking'], ['address'])) candidates.push('delivery');
  if (hasIndependent(['student_id'], ['gpa', 'course'])) candidates.push('transcript');
  return candidates.length === 1 ? candidates[0] : null;
}
