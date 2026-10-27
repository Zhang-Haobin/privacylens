export function fitImageScale(imageWidth, imageHeight, availableWidth, availableHeight) {
  if (![imageWidth, imageHeight, availableWidth, availableHeight].every(value => Number.isFinite(value) && value > 0)) return 1;
  return Math.min(1, availableWidth / imageWidth, availableHeight / imageHeight);
}

// Size the desktop group around the image, while keeping the review panel bounded.
export function workspaceLayout(imageWidth, imageHeight, availableWidth, stageHeight, preferredReviewWidth = 380) {
  if (![imageWidth, imageHeight, availableWidth, stageHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const reviewWidth = Math.min(Math.max(340, preferredReviewWidth), 460, Math.max(0, availableWidth - 320));
  const maxPreview = Math.max(0, availableWidth - reviewWidth);
  // Reserve a useful share of desktop width even for narrow portrait images.
  // The image remains proportional; Inspect uses the extra width for readable detail.
  const aspect = Math.max(0.4, Math.min(2, imageWidth / imageHeight));
  const targetFraction = 0.72 + 0.22 * aspect / 2;
  const minimum = Math.min(maxPreview, Math.max(480, availableWidth * targetFraction - reviewWidth));
  const longImage = imageHeight / imageWidth >= 3;
  const desired = longImage ? Math.min(imageWidth, 640) + 40 : Math.min(imageWidth, stageHeight * imageWidth / imageHeight) + 40;
  const previewWidth = Math.round(Math.max(minimum, Math.min(maxPreview, desired)));
  return { reviewWidth, previewWidth, workspaceWidth: previewWidth + reviewWidth, longImage };
}
