const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// All coordinates are original-image pixels. The same rectangle is used by the
// preview and the flattened export, so a drag must never leave the image.
export function adjustMaskRect(rect, handle, deltaX, deltaY, imageWidth, imageHeight) {
  let [left, top, width, height] = rect;
  let right = left + width, bottom = top + height;
  const dx = Math.round(deltaX), dy = Math.round(deltaY);
  if (handle === 'move') {
    left = clamp(left + dx, 0, imageWidth - width);
    top = clamp(top + dy, 0, imageHeight - height);
    return [left, top, width, height];
  }
  if (!['nw', 'ne', 'sw', 'se'].includes(handle)) throw new Error('Invalid mask handle');
  if (handle.includes('w')) left = clamp(left + dx, 0, right - 5);
  else right = clamp(right + dx, left + 5, imageWidth);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - 5);
  else bottom = clamp(bottom + dy, top + 5, imageHeight);
  return [left, top, right - left, bottom - top];
}
