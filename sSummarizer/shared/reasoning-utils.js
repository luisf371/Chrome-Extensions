// A provider retry starts a new block sequence, even when it reuses ids/indexes.
// Keep this declaration reinjection-safe for content scripts.
function mergeReasoningDetails(target, details, startIndex = 0) {
  for (const detail of details) {
    const previous = target.length > startIndex ? target[target.length - 1] : null;
    const field = detail.type === 'reasoning.text' ? 'text' : detail.type === 'reasoning.summary' ? 'summary' : null;
    const compatible = previous?.type === detail.type &&
      ['id', 'format', 'index'].every(key => previous[key] == null || detail[key] == null || previous[key] === detail[key]);
    if (field && compatible && (typeof detail[field] === 'string' || typeof detail.signature === 'string')) {
      if (typeof detail[field] === 'string') previous[field] = (previous[field] || '') + detail[field];
      for (const key of ['id', 'format', 'index']) if (previous[key] == null && detail[key] != null) previous[key] = detail[key];
      if (typeof detail.signature === 'string') previous.signature = (previous.signature || '') + detail.signature;
    } else {
      target.push({ ...detail });
    }
  }
}
