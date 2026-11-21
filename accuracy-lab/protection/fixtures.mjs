import { createProtectionInput } from '../../dist/protection.js';

// Categories only, from the same fictional delivery screenshot and audience.
export const deliveryFields = [
  { id: 'f1', category: 'name' },
  { id: 'f2', category: 'phone' },
  { id: 'f3', category: 'address' },
  { id: 'f4', category: 'order' },
  { id: 'f5', category: 'tracking' },
  { id: 'f6', category: 'payment' }
];
export const orderField = deliveryFields[3];
export const deliveryRequest = purpose => createProtectionInput({ documentType: 'delivery', context: 'support', customPurpose: purpose }, deliveryFields).body;
export const purposeCases = [
  { id: 'lookup-en', purpose: 'Please help me locate my delayed package.', order: 'review' },
  { id: 'schedule-en', purpose: 'I want to know whether deliveries are available on weekends.', order: 'hide' },
  { id: 'lookup-zh', purpose: '我的包裹一直未收到，想請快遞客服幫我查到這筆配送的進度。', order: 'review' },
  { id: 'schedule-zh', purpose: '我只想了解星期六和星期日是否提供配送服務。', order: 'hide' },
  { id: 'lookup-paraphrase', purpose: 'My parcel has not arrived. Could the carrier check whether it was sent to the wrong delivery area?', order: 'review' },
  { id: 'schedule-paraphrase', purpose: 'I am planning a future purchase. Can the carrier explain its Sunday delivery policy?', order: 'hide' }
];
