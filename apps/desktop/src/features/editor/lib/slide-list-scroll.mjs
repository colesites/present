export function clampSlideListScrollTop(value, maxScrollTop) {
  if (!Number.isFinite(value) || !Number.isFinite(maxScrollTop)) {
    return 0;
  }
  return Math.min(Math.max(0, value), Math.max(0, maxScrollTop));
}

export function resolveSlideListScrollTop({ current, saved, maxScrollTop }) {
  const normalizedCurrent = clampSlideListScrollTop(current, maxScrollTop);
  const normalizedSaved = clampSlideListScrollTop(saved, maxScrollTop);

  if (normalizedCurrent === 0 && normalizedSaved > 0) {
    return normalizedSaved;
  }

  return normalizedCurrent;
}
