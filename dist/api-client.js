export async function readAPI(response) {
  // Platform gateways can return HTML or plain text. Status still carries meaning.
  const errors = {
    413: 'The request is too large. Crop the screenshot into smaller sections.',
    429: 'The AI service is rate limited. Wait before trying again.',
    502: 'The AI service or gateway is unavailable. Try again later.',
    503: 'The AI service or gateway is unavailable. Try again later.',
    504: 'The AI service timed out. Try again later or review manually.'
  };
  let result;
  try { result = await response.json(); } catch { /* Non-JSON platform response. */ }
  if (!response.ok) {
    const message = typeof result?.error === 'string' ? result.error : errors[response.status] || `The AI request failed (HTTP ${response.status}). Try again later.`;
    throw new Error(`${message} Existing masks are unchanged.`);
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('The AI service returned an invalid response. Existing masks are unchanged.');
  return result;
}
