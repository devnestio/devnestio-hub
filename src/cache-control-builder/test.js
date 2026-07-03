const assert = require('assert');

// Core logic extracted from cache-control-builder

const DIRECTIVES = [
  { id: 'public',    label: 'public',    kind: 'flag', group: 'Visibility' },
  { id: 'private',   label: 'private',   kind: 'flag', group: 'Visibility' },
  { id: 'no-store',  label: 'no-store',  kind: 'flag', group: 'Storage' },
  { id: 'no-cache',  label: 'no-cache',  kind: 'flag', group: 'Revalidation' },
  { id: 'max-age',   label: 'max-age',   kind: 'seconds', group: 'Freshness (browser)' },
  { id: 's-maxage',  label: 's-maxage',  kind: 'seconds', group: 'Freshness (shared)' },
  { id: 'must-revalidate', label: 'must-revalidate', kind: 'flag', group: 'Revalidation' },
  { id: 'proxy-revalidate', label: 'proxy-revalidate', kind: 'flag', group: 'Revalidation' },
  { id: 'immutable', label: 'immutable', kind: 'flag', group: 'Freshness (browser)' },
  { id: 'stale-while-revalidate', label: 'stale-while-revalidate', kind: 'seconds', group: 'Advanced' },
  { id: 'stale-if-error', label: 'stale-if-error', kind: 'seconds', group: 'Advanced' },
  { id: 'must-understand', label: 'must-understand', kind: 'flag', group: 'Advanced' },
  { id: 'no-transform', label: 'no-transform', kind: 'flag', group: 'Advanced' },
];

const PRESETS = {
  static:  { public: true, 'max-age': 31536000, immutable: true },
  html:    { public: true, 'max-age': 0, 'must-revalidate': true },
  api:     { private: true, 'max-age': 0, 'no-cache': true },
  private: { private: true, 'no-store': true },
  nocache: { 'no-cache': true, 'must-revalidate': true },
  nostore: { 'no-store': true },
  cdn:     { public: true, 's-maxage': 86400, 'max-age': 3600 },
  swr:     { public: true, 'max-age': 60, 'stale-while-revalidate': 86400 },
};

function buildValue(active) {
  // active: { id: value } where value is true (flag) or number (seconds)
  const parts = [];
  DIRECTIVES.forEach(d => {
    if (!(d.id in active)) return;
    if (d.kind === 'flag') parts.push(d.label);
    else { const s = active[d.id]; if (s >= 0) parts.push(`${d.label}=${s}`); }
  });
  return parts.join(', ') || '(none)';
}

function getConflicts(active) {
  const conflicts = [];
  const on = id => id in active;
  if (on('public') && on('private')) conflicts.push('public and private are mutually exclusive.');
  if (on('no-store') && on('no-cache')) conflicts.push('no-store makes no-cache redundant (no-store is stronger).');
  if (on('no-store') && on('max-age')) conflicts.push('no-store overrides max-age — the value will be ignored.');
  if (on('immutable') && on('no-cache')) conflicts.push('immutable and no-cache are contradictory.');
  if (on('must-revalidate') && on('no-store')) conflicts.push('must-revalidate and no-store conflict — stale responses cannot be served if nothing is stored.');
  return conflicts;
}

function buildSnippet(tab, val) {
  if (tab === 'express') return `// Express.js\nres.set('Cache-Control', '${val}');`;
  if (tab === 'nginx') return `# nginx\nadd_header Cache-Control "${val}" always;`;
  if (tab === 'apache') return `# Apache (.htaccess / VirtualHost)\nHeader always set Cache-Control "${val}"`;
  if (tab === 'cf') return `// CloudFront Response Headers Policy\n// Console → CloudFront → Policies → Response headers\n// Name: Cache-Control, Value: ${val}\n\n// Or via CloudFront Function:\nfunction handler(event) {\n  var response = event.response;\n  response.headers['cache-control'] = { value: '${val}' };\n  return response;\n}`;
  return val;
}

let passed = 0;
function test(desc, fn) {
  try { fn(); passed++; console.log(`  ✓ ${desc}`); }
  catch(e) { console.error(`  ✗ ${desc}: ${e.message}`); process.exit(1); }
}

// --- DIRECTIVES structure tests ---
console.log('\n[1] DIRECTIVES structure');
test('Is array', () => assert(Array.isArray(DIRECTIVES)));
test('Has 13 directives', () => assert.strictEqual(DIRECTIVES.length, 13));
DIRECTIVES.forEach(d => {
  test(`${d.id}: has id`, () => assert(typeof d.id === 'string' && d.id.length > 0));
  test(`${d.id}: has label`, () => assert(typeof d.label === 'string'));
  test(`${d.id}: has kind flag or seconds`, () => assert(d.kind === 'flag' || d.kind === 'seconds'));
  test(`${d.id}: has group`, () => assert(typeof d.group === 'string' && d.group.length > 0));
});

// --- buildValue tests ---
console.log('\n[2] buildValue — presets');
test('static preset produces correct value', () => {
  const v = buildValue({ public: true, 'max-age': 31536000, immutable: true });
  assert(v.includes('public'));
  assert(v.includes('max-age=31536000'));
  assert(v.includes('immutable'));
});
test('html preset produces correct value', () => {
  const v = buildValue({ public: true, 'max-age': 0, 'must-revalidate': true });
  assert(v.includes('public'));
  assert(v.includes('max-age=0'));
  assert(v.includes('must-revalidate'));
});
test('api preset produces correct value', () => {
  const v = buildValue({ private: true, 'max-age': 0, 'no-cache': true });
  assert(v.includes('private'));
  assert(v.includes('no-cache'));
});
test('nostore preset produces no-store only', () => {
  const v = buildValue({ 'no-store': true });
  assert.strictEqual(v, 'no-store');
});
test('cdn preset produces s-maxage', () => {
  const v = buildValue({ public: true, 's-maxage': 86400, 'max-age': 3600 });
  assert(v.includes('s-maxage=86400'));
  assert(v.includes('max-age=3600'));
});
test('swr preset produces stale-while-revalidate', () => {
  const v = buildValue({ public: true, 'max-age': 60, 'stale-while-revalidate': 86400 });
  assert(v.includes('stale-while-revalidate=86400'));
});
test('empty active returns (none)', () => {
  assert.strictEqual(buildValue({}), '(none)');
});

console.log('\n[3] buildValue — ordering matches DIRECTIVES order');
test('public comes before private in output', () => {
  const v = buildValue({ public: true, 'max-age': 100, immutable: true });
  const pi = v.indexOf('public'), mi = v.indexOf('max-age'), ii = v.indexOf('immutable');
  assert(pi < mi && mi < ii);
});
test('no-cache comes before max-age when both set (based on DIRECTIVES order)', () => {
  const v = buildValue({ 'no-cache': true, 'max-age': 3600 });
  // no-cache (idx 3) comes before max-age (idx 4) in DIRECTIVES
  assert(v.indexOf('no-cache') < v.indexOf('max-age'));
});

console.log('\n[4] buildValue — seconds format');
test('max-age=0 is included', () => assert(buildValue({ 'max-age': 0 }).includes('max-age=0')));
test('stale-if-error=3600 is included', () => assert(buildValue({ 'stale-if-error': 3600 }).includes('stale-if-error=3600')));
test('s-maxage=0 is included', () => assert(buildValue({ 's-maxage': 0 }).includes('s-maxage=0')));
test('Single flag has no comma', () => assert(!buildValue({ public: true }).includes(',')));
test('Two flags have one comma', () => {
  const v = buildValue({ public: true, immutable: true });
  assert.strictEqual((v.match(/,/g) || []).length, 1);
});

// --- getConflicts tests ---
console.log('\n[5] getConflicts — valid combinations return no conflicts');
test('public + max-age: no conflict', () => assert.strictEqual(getConflicts({ public: true, 'max-age': 3600 }).length, 0));
test('private + no-store: no conflict', () => assert.strictEqual(getConflicts({ private: true, 'no-store': true }).length, 0));
test('no-cache + must-revalidate: no conflict', () => assert.strictEqual(getConflicts({ 'no-cache': true, 'must-revalidate': true }).length, 0));
test('s-maxage + max-age: no conflict', () => assert.strictEqual(getConflicts({ 's-maxage': 86400, 'max-age': 3600 }).length, 0));

console.log('\n[6] getConflicts — conflicting combinations');
test('public + private: 1 conflict', () => assert.strictEqual(getConflicts({ public: true, private: true }).length, 1));
test('no-store + no-cache: 1 conflict', () => assert.strictEqual(getConflicts({ 'no-store': true, 'no-cache': true }).length, 1));
test('no-store + max-age: 1 conflict', () => assert.strictEqual(getConflicts({ 'no-store': true, 'max-age': 3600 }).length, 1));
test('immutable + no-cache: 1 conflict', () => assert.strictEqual(getConflicts({ immutable: true, 'no-cache': true }).length, 1));
test('must-revalidate + no-store: 1 conflict', () => assert.strictEqual(getConflicts({ 'must-revalidate': true, 'no-store': true }).length, 1));
test('public + private + no-store + max-age: 2 conflicts', () => {
  const c = getConflicts({ public: true, private: true, 'no-store': true, 'max-age': 3600 });
  assert(c.length >= 2);
});
test('conflict messages are strings', () => {
  const c = getConflicts({ public: true, private: true });
  assert(typeof c[0] === 'string' && c[0].length > 0);
});

// --- buildSnippet tests ---
console.log('\n[7] buildSnippet');
const testVal = 'public, max-age=3600';
test('express snippet contains res.set', () => assert(buildSnippet('express', testVal).includes("res.set('Cache-Control'")));
test('express snippet contains value', () => assert(buildSnippet('express', testVal).includes(testVal)));
test('nginx snippet contains add_header', () => assert(buildSnippet('nginx', testVal).includes('add_header Cache-Control')));
test('nginx snippet contains always', () => assert(buildSnippet('nginx', testVal).includes('always')));
test('apache snippet contains Header always set', () => assert(buildSnippet('apache', testVal).includes('Header always set Cache-Control')));
test('cf snippet contains CloudFront', () => assert(buildSnippet('cf', testVal).includes('CloudFront')));
test('cf snippet contains handler function', () => assert(buildSnippet('cf', testVal).includes('function handler')));
test('all snippets contain the value', () => {
  ['express','nginx','apache','cf'].forEach(tab => {
    assert(buildSnippet(tab, testVal).includes(testVal), `Tab ${tab} missing value`);
  });
});

// --- PRESETS validation ---
console.log('\n[8] PRESETS validation');
test('8 presets exist', () => assert.strictEqual(Object.keys(PRESETS).length, 8));
const presetKeys = ['static','html','api','private','nocache','nostore','cdn','swr'];
presetKeys.forEach(k => {
  test(`Preset "${k}" exists`, () => assert(k in PRESETS));
  test(`Preset "${k}" is non-empty object`, () => assert(Object.keys(PRESETS[k]).length > 0));
});
test('static preset has public', () => assert(PRESETS.static.public));
test('static preset has max-age=31536000', () => assert.strictEqual(PRESETS.static['max-age'], 31536000));
test('static preset has immutable', () => assert(PRESETS.static.immutable));
test('private preset has no-store', () => assert(PRESETS.private['no-store']));
test('swr preset has stale-while-revalidate', () => assert('stale-while-revalidate' in PRESETS.swr));
test('cdn preset has s-maxage', () => assert('s-maxage' in PRESETS.cdn));
test('nostore preset has no-store', () => assert(PRESETS.nostore['no-store']));
test('html preset max-age is 0', () => assert.strictEqual(PRESETS.html['max-age'], 0));

// --- All preset outputs are valid strings ---
console.log('\n[9] Preset output quality');
presetKeys.forEach(k => {
  const v = buildValue(PRESETS[k]);
  test(`Preset "${k}" output is non-empty string`, () => assert(typeof v === 'string' && v.length > 0));
  test(`Preset "${k}" output is not "(none)"`, () => assert(v !== '(none)'));
  test(`Preset "${k}" has no trailing comma`, () => assert(!v.endsWith(',')));
  test(`Preset "${k}" has no double spaces`, () => assert(!v.includes('  ')));
});

console.log(`\n✅ All ${passed} tests passed\n`);
