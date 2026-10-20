/** Pure collection calculations. All values come from the supplied records. */
const DAY = 24 * 60 * 60 * 1000;
const nameOrder = new Intl.Collator('it', { sensitivity: 'base', numeric: true });
const records = items => Array.isArray(items)
  ? items.filter(item => item && typeof item === 'object' && !Array.isArray(item))
  : [];
const numeric = value => {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const parsed = Number(typeof value === 'string' ? value.trim().replace(',', '.') : value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const quantity = item => numeric(item.qty);
const valueOf = item => numeric(item.current) * quantity(item);
const paidOf = item => numeric(item.paid) * quantity(item);
const hasCost = item => numeric(item.paid) > 0;
const hasPhoto = item => typeof item.image === 'string' && item.image.trim().length > 0;
const quoteAt = item => numeric(item.market?.at);
const itemName = item => [item.brand, item.model, item.colorway].filter(Boolean).join(' ');

/** Accent-insensitive text suitable for searches and categorical comparisons. */
export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/\s+/gu, ' ').trim();
}

function sizeKey(value) {
  const text = normalizeSearch(value).replace(/^eu\s*/u, '').replace(',', '.');
  if (!text) return '';
  const parsed = Number(text);
  return Number.isFinite(parsed) ? String(parsed) : text;
}

function boundary(value) {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
  const parsed = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function addedAt(item) {
  const value = item.added;
  if (value == null || value === '') return 0;
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/u.test(String(value).trim())) return numeric(value);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Return a new array while keeping original item objects and every field intact.
 * Value sorting uses the whole holding; price bounds use the price per pair.
 * A zero/missing acquisition cost is unknown for profit comparisons.
 */
export function queryItems(items, filters = {}, now = Date.now()) {
  const options = filters || {};
  const tokens = normalizeSearch(options.query).split(' ').filter(Boolean);
  const brand = normalizeSearch(options.brand);
  const condition = normalizeSearch(options.condition);
  const size = sizeKey(options.size);
  const minimum = boundary(options.minPrice);
  const maximum = boundary(options.maxPrice);
  const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const output = records(items).filter(item => {
    if (options.watchOnly && !item.watch) return false;
    if (brand && normalizeSearch(item.brand) !== brand) return false;
    if (condition && normalizeSearch(item.condition) !== condition) return false;
    if (size && sizeKey(item.size) !== size) return false;
    const price = numeric(item.current);
    if (minimum != null && price < minimum) return false;
    if (maximum != null && price > maximum) return false;
    if (options.quick === 'missing-cost' && hasCost(item)) return false;
    if (options.quick === 'missing-photo' && hasPhoto(item)) return false;
    if (options.quick === 'stale') {
      const at = quoteAt(item);
      if (at > 0 && timestamp - at <= 30 * DAY) return false;
    }
    if (tokens.length) {
      const normalizedSize = sizeKey(item.size);
      const searchable = normalizeSearch([
        item.brand, item.model, item.sku, item.colorway, item.notes,
        item.size, normalizedSize, normalizedSize.replace('.', ',')
      ].join(' '));
      if (!tokens.every(token => searchable.includes(token))) return false;
    }
    return true;
  });
  // Modern JS sort is stable; equal values retain the original archive order.
  const comparators = {
    'value-desc': (a, b) => valueOf(b) - valueOf(a),
    'value-asc': (a, b) => valueOf(a) - valueOf(b),
    name: (a, b) => nameOrder.compare(itemName(a), itemName(b)),
    recent: (a, b) => addedAt(b) - addedAt(a),
    'gain-desc': (a, b) => {
      const knownA = hasCost(a), knownB = hasCost(b);
      if (knownA !== knownB) return knownA ? -1 : 1;
      if (!knownA) return 0;
      return (valueOf(b) - paidOf(b)) - (valueOf(a) - paidOf(a));
    }
  };
  if (comparators[options.sort]) output.sort(comparators[options.sort]);
  return output;
}

/** Aggregate known quantities and costs without treating a missing cost as profit. */
export function collectionStats(items) {
  const list = records(items);
  const stats = {
    count: list.length, pairs: 0, value: 0, spent: 0,
    costedCount: 0, comparableValue: 0, gain: 0, returnPct: null,
    missingCost: 0, missingPhotos: 0, watchCount: 0, lastQuoteAt: null
  };
  for (const item of list) {
    const value = valueOf(item);
    stats.pairs += quantity(item);
    stats.value += value;
    if (hasCost(item)) {
      stats.costedCount++;
      stats.spent += paidOf(item);
      stats.comparableValue += value;
    } else stats.missingCost++;
    if (!hasPhoto(item)) stats.missingPhotos++;
    if (item.watch) stats.watchCount++;
    const at = quoteAt(item);
    if (at > 0 && (stats.lastQuoteAt == null || at > stats.lastQuoteAt)) stats.lastQuoteAt = at;
  }
  stats.gain = stats.comparableValue - stats.spent;
  stats.returnPct = stats.spent > 0 ? stats.gain / stats.spent * 100 : null;
  return stats;
}

/** Group equivalent brand spellings; share is a 0..1 fraction of total value. */
export function brandBreakdown(items) {
  const groups = new Map();
  let totalValue = 0;
  for (const item of records(items)) {
    const label = String(item.brand ?? '').trim() || 'Senza brand';
    const key = normalizeSearch(label);
    if (!groups.has(key)) groups.set(key, { brand: label, value: 0, pairs: 0, count: 0, share: 0 });
    const group = groups.get(key);
    const value = valueOf(item);
    group.value += value;
    group.pairs += quantity(item);
    group.count++;
    totalValue += value;
  }
  return [...groups.values()].map(group => ({
    ...group, share: totalValue > 0 ? group.value / totalValue : 0
  })).sort((a, b) => b.value - a.value || nameOrder.compare(a.brand, b.brand));
}
