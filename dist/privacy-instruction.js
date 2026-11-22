import { textLineTargets, ocrWordRegion } from './mask-targets.js';
import { categoryNames, textCategories } from './privacy-types.js';
import { documentTypes } from './document-context.js';
import { screenSharedDescription } from './protection.js';

export const instructionLimit = 500;
const personalCategories = new Set(textCategories.filter(category => !['university', 'course', 'grade', 'gpa'].includes(category)));
const wholeCommands = [
  [/^(?:hide|mask|redact) (?:all |every |the )?(?:ocr[- ]detected )?text$|^(?:遮住|遮挡|遮擋|隐藏|隱藏|盖住|蓋住)(?:所有|全部)?(?:的)?(?:文字|文本)$/u, { type: 'mask_text' }],
  [/^(?:hide|mask|redact) (?:all |the )?personal (?:information|details|data)$|^(?:遮住|遮挡|遮擋|隐藏|隱藏)(?:所有|全部)?(?:的)?(?:个人|個人)(?:信息|資訊|资料|資料)$/u, { type: 'mask_personal' }],
  [/^(?:hide|mask|redact) (?:everything|the (?:entire|whole) (?:image|screenshot)|the (?:image|screenshot) completely)$|^(?:遮住|遮挡|遮擋|隐藏|隱藏)(?:全部|所有内容|所有內容|整张截图|整張截圖|整张图片|整張圖片)$/u, { type: 'mask_image' }],
  [/^(?:hide|mask|redact) (?:all |the )?(?:numbers|digits)$|^(?:遮住|遮挡|遮擋|隐藏|隱藏)(?:全部|所有)?(?:的)?(?:数字|數字)$/u, { type: 'mask_numbers' }],
  [/^(?:hide|mask|redact) (?:a |one |the )?specific (?:area|region)$|^(?:遮住|遮挡|遮擋|隐藏|隱藏)(?:一块|一塊|某个|某個)?(?:指定|特定)?(?:区域|區域)$/u, { type: 'draw_area' }],
  [/^(?:keep only|only keep|hide everything (?:except|but)) (?:the )?(?:delivery|order|shipping|tracking) status$|^(?:只保留|仅保留|僅保留)(?:订单|訂單|物流|配送|运送|運送)(?:状态|狀態)$/u, { type: 'keep_area' }],
  [/^hide personal (?:details|information) but keep (?:the )?(?:delivery|order|shipping|tracking) status$/u, { type: 'mask_personal' }]
];
const fieldTerms = [
  [/^(?:phone(?: numbers?)?|mobile(?: numbers?)?|电话(?:号码)?|電話(?:號碼)?|手机(?:号码)?|手機(?:號碼)?)$/u, 'phone'],
  [/^(?:(?:shipping |delivery |home )?address(?:es)?|(?:收货|收貨|配送)?地址)$/u, 'address'],
  [/^(?:names?|姓名|名字)$/u, 'name'],
  [/^(?:e-?mails?(?: address(?:es)?)?|邮箱|郵箱|电子邮件|電子郵件|電郵)$/u, 'email'],
  [/^(?:order (?:numbers?|ids?)|(?:订单|訂單)(?:号|號|编号|編號))$/u, 'order'],
  [/^(?:tracking (?:numbers?|ids?)|(?:运单|運單|物流)(?:号|號|编号|編號))$/u, 'tracking'],
  [/^(?:payment (?:details|information)|card numbers?|银行卡号|銀行卡號|付款资料|付款資料)$/u, 'payment'],
  [/^(?:access (?:credentials|tokens)|passwords?|api keys?|密码|密碼|访问令牌|存取權杖)$/u, 'secret']
];
const sides = { top: 'top', bottom: 'bottom', left: 'left', right: 'right', 上: 'top', 下: 'bottom', 左: 'left', 右: 'right' };

function parseCommand(command) {
  const exact = wholeCommands.find(([pattern]) => pattern.test(command));
  if (exact) return exact[1];
  const half = command.match(/^(?:hide|mask|redact) (?:the )?(top|bottom|left|right) half(?: of (?:the )?(?:screenshot|image))?$|^(?:遮住|遮挡|遮擋|隐藏|隱藏)(?:截图|截圖|图片|圖片)?(?:的)?([上下左右])半(?:部|部分|边|邊)?$/u);
  if (half) return { type: 'mask_half', side: sides[half[1] || half[2]] };
  const targets = command.match(/^(?:(?:hide|mask|redact) (?:the )?|(?:遮住|遮挡|遮擋|隐藏|隱藏))(.+)$/u)?.[1];
  if (!targets) return null;
  const terms = targets.split(/\s*(?:,?\s+and\s+|,|、|以及|和|及|与|與)\s*/u);
  const categories = terms.map(term => fieldTerms.find(([pattern]) => pattern.test(term))?.[1]);
  return categories.every(Boolean) ? { type: 'mask_fields', categories: [...new Set(categories)] } : null;
}

export function parsePrivacyInstruction(instruction) {
  const normalized = instruction.normalize('NFKC').trim().toLowerCase();
  const commands = normalized.split(/[\r\n;。.!！?？；]+/u)
    .map(line => line.trim().replace(/^(?:please\s+|请\s*|請\s*)/u, '').replace(/\s+/gu, ' ')
      .replace(/(?<=\p{Script=Han}) (?=\p{Script=Han})/gu, ''))
    .filter(Boolean);
  if (commands.length === 1) return parseCommand(commands[0]);
  const operations = commands.map(parseCommand);
  // Multiple clauses are supported when every clause names a category to hide.
  if (operations.length && operations.every(operation => operation?.type === 'mask_fields')) {
    return { type: 'mask_fields', categories: [...new Set(operations.flatMap(operation => operation.categories))] };
  }
  return null;
}

export function instructionFieldCategories(operation) {
  if (operation?.type === 'mask_personal') return personalCategories;
  return operation?.type === 'mask_fields' ? new Set(operation.categories) : null;
}

export function validKeepArea(rect, width, height) {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isSafeInteger)) return false;
  const [x, y, w, h] = rect;
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height && (w < width || h < height);
}

export function instructionRectangles(operation, { width, height, document, keepArea }) {
  if (!operation || ![width, height].every(value => Number.isSafeInteger(value) && value > 0)) return [];
  if (operation.type === 'mask_image') return [[0, 0, width, height]];
  if (operation.type === 'mask_half') {
    const halfWidth = Math.ceil(width / 2), halfHeight = Math.ceil(height / 2);
    const halves = {
      top: [0, 0, width, halfHeight], bottom: [0, height - halfHeight, width, halfHeight],
      left: [0, 0, halfWidth, height], right: [width - halfWidth, 0, halfWidth, height]
    };
    return Object.hasOwn(halves, operation.side) ? [halves[operation.side]] : [];
  }
  if (operation.type === 'keep_area' && validKeepArea(keepArea, width, height)) {
    const [x, y, w, h] = keepArea;
    return [[0, 0, width, y], [0, y + h, width, height - y - h], [0, y, x, h], [x + w, y, width - x - w, h]]
      .filter(([, , w, h]) => w > 0 && h > 0);
  }
  if (!document || document.width !== width || document.height !== height) return [];
  if (operation.type === 'mask_text') return textLineTargets(document).map(line => line.rect);
  if (operation.type === 'mask_numbers') {
    return document.words.filter(word => /\p{N}/u.test(word.text)).map(word => ocrWordRegion([word], width, height)).filter(Boolean);
  }
  return [];
}

export function instructionOperationLabel(operation) {
  const labels = {
    mask_text: 'Cover all OCR-detected text',
    mask_personal: 'Cover detected personal information',
    mask_numbers: 'Cover recognized words containing numbers',
    mask_image: 'Cover the whole image'
  };
  if (operation.type === 'mask_half') return 'Cover the ' + operation.side + ' half';
  if (operation.type === 'mask_fields') return 'Cover detected ' + operation.categories.map(category => categoryNames[category].toLowerCase()).join(', ');
  return labels[operation.type];
}

// The provider can only suggest additive masks. The editor owns all coordinates.
const wholeMaskTypes = ['mask_text', 'mask_personal', 'mask_numbers', 'mask_image'];
export const instructionResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'privacy_instruction_operation', strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['operations'],
      properties: {
        operations: {
          type: 'array', maxItems: 1,
          items: {
            anyOf: [
              { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { type: 'string', enum: wholeMaskTypes } } },
              { type: 'object', additionalProperties: false, required: ['type', 'categories'], properties: {
                type: { type: 'string', enum: ['mask_fields'] },
                categories: { type: 'array', minItems: 1, maxItems: textCategories.length, items: { type: 'string', enum: textCategories } }
              } }
            ]
          }
        }
      }
    }
  }
};

function exactObject(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function uniqueCategories(values, allowed) {
  return Array.isArray(values) && values.length <= allowed.length && new Set(values).size === values.length
    && values.every(value => allowed.includes(value));
}
export function validateInstructionRequest(body) {
  if (!exactObject(body, ['consent', 'documentType', 'instruction', 'categories']) || body.consent !== true) {
    throw new Error('Confirm sending only the screened instruction and listed categories.');
  }
  const { documentType, instruction, categories } = body;
  if (typeof documentType !== 'string' || !Object.hasOwn(documentTypes, documentType)
      || !uniqueCategories(categories, textCategories) || typeof instruction !== 'string' || !instruction.trim()
      || instruction.length > instructionLimit || instruction !== screenSharedDescription(instruction, [])) {
    throw new Error('The instruction or field categories cannot be used for AI interpretation.');
  }
  return { documentType, instruction, categories };
}
export function createInstructionRequest(documentType, text, fields) {
  const body = {
    consent: true, documentType,
    instruction: screenSharedDescription(text, fields),
    categories: [...new Set(fields.map(field => field.category))]
  };
  validateInstructionRequest(body);
  return body;
}
export function validateInstructionOperations(result, categories) {
  if (!exactObject(result, ['operations']) || !Array.isArray(result.operations) || result.operations.length > 1) {
    throw new Error('AI returned an invalid instruction operation.');
  }
  return result.operations.map(operation => {
    if (exactObject(operation, ['type']) && wholeMaskTypes.includes(operation.type)) return { type: operation.type };
    if (exactObject(operation, ['type', 'categories']) && operation.type === 'mask_fields'
        && uniqueCategories(operation.categories, categories) && operation.categories.length) {
      return { type: operation.type, categories: [...operation.categories] };
    }
    throw new Error('AI returned an unsupported instruction operation.');
  });
}
