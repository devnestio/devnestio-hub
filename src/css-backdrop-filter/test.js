const assert = require('assert');

// Core logic extracted from css-backdrop-filter

const FILTERS = [
  { id: 'blur',       label: 'blur',       unit: 'px',  min: 0, max: 40,  step: 0.5, def: 0,   desc: 'Blur radius' },
  { id: 'brightness', label: 'brightness', unit: '%',   min: 0, max: 200, step: 5,   def: 100, desc: 'Brightness %' },
  { id: 'contrast',   label: 'contrast',   unit: '%',   min: 0, max: 200, step: 5,   def: 100, desc: 'Contrast %' },
  { id: 'grayscale',  label: 'grayscale',  unit: '%',   min: 0, max: 100, step: 5,   def: 0,   desc: 'Grayscale %' },
  { id: 'hue-rotate', label: 'hue-rotate', unit: 'deg', min: 0, max: 360, step: 5,   def: 0,   desc: 'Hue rotation' },
  { id: 'invert',     label: 'invert',     unit: '%',   min: 0, max: 100, step: 5,   def: 0,   desc: 'Invert %' },
  { id: 'opacity',    label: 'opacity',    unit: '%',   min: 0, max: 100, step: 5,   def: 100, desc: 'Opacity %' },
  { id: 'saturate',   label: 'saturate',   unit: '%',   min: 0, max: 300, step: 5,   def: 100, desc: 'Saturation %' },
  { id: 'sepia',      label: 'sepia',      unit: '%',   min: 0, max: 100, step: 5,   def: 0,   desc: 'Sepia %' },
];

const PRESETS = {
  frosted: { blur: [12, true], brightness: [110, true], saturate: [160, true] },
  dark:    { blur: [8, true], brightness: [40, true], contrast: [120, true] },
  bright:  { blur: [4, true], brightness: [180, true], saturate: [200, true] },
  vintage: { sepia: [60, true], contrast: [110, true], brightness: [90, true], saturate: [80, true] },
  noir:    { grayscale: [100, true], contrast: [130, true], brightness: [80, true] },
  reset:   null,
};

function buildFilterStr(active) {
  // active: { id: value } for active filters
  const parts = [];
  FILTERS.forEach(f => {
    if (!(f.id in active)) return;
    const v = active[f.id];
    if (f.unit === '%') parts.push(`${f.label}(${v}%)`);
    else parts.push(`${f.label}(${v}${f.unit})`);
  });
  return parts.length ? parts.join(' ') : 'none';
}

function buildCSS(active) {
  const filterVal = buildFilterStr(active);
  if (Object.keys(active).length === 0) {
    return `.element {\n  /* No active filters — enable some on the left */\n  backdrop-filter: none;\n  -webkit-backdrop-filter: none;\n}`;
  }
  return `.element {\n  backdrop-filter: ${filterVal};\n  -webkit-backdrop-filter: ${filterVal}; /* Safari */\n}`;
}

function buildFullCSS(active) {
  const fs = buildFilterStr(active);
  return `.element {\n  /* Background context needed for backdrop-filter to have effect */\n  background: rgba(255, 255, 255, 0.1);\n  border: 1px solid rgba(255, 255, 255, 0.2);\n  border-radius: 16px;\n  backdrop-filter: ${fs};\n  -webkit-backdrop-filter: ${fs}; /* Safari */\n}`;
}

let passed = 0;
function test(desc, fn) {
  try { fn(); passed++; console.log(`  ✓ ${desc}`); }
  catch(e) { console.error(`  ✗ ${desc}: ${e.message}`); process.exit(1); }
}

// --- FILTERS structure ---
console.log('\n[1] FILTERS structure');
test('Is array', () => assert(Array.isArray(FILTERS)));
test('Has 9 filter functions', () => assert.strictEqual(FILTERS.length, 9));
FILTERS.forEach(f => {
  test(`${f.id}: has id`, () => assert(typeof f.id === 'string' && f.id.length > 0));
  test(`${f.id}: has label`, () => assert(typeof f.label === 'string'));
  test(`${f.id}: has unit`, () => assert(['px','%','deg'].includes(f.unit)));
  test(`${f.id}: min < max`, () => assert(f.min < f.max));
  test(`${f.id}: def in range`, () => assert(f.def >= f.min && f.def <= f.max));
  test(`${f.id}: step > 0`, () => assert(f.step > 0));
  test(`${f.id}: has desc`, () => assert(typeof f.desc === 'string' && f.desc.length > 0));
});

// --- buildFilterStr ---
console.log('\n[2] buildFilterStr — empty');
test('Empty active returns "none"', () => assert.strictEqual(buildFilterStr({}), 'none'));

console.log('\n[3] buildFilterStr — single filters');
test('blur(12px)', () => assert.strictEqual(buildFilterStr({ blur: 12 }), 'blur(12px)'));
test('blur(0px)', () => assert.strictEqual(buildFilterStr({ blur: 0 }), 'blur(0px)'));
test('brightness(100%)', () => assert.strictEqual(buildFilterStr({ brightness: 100 }), 'brightness(100%)'));
test('brightness(0%)', () => assert.strictEqual(buildFilterStr({ brightness: 0 }), 'brightness(0%)'));
test('contrast(200%)', () => assert.strictEqual(buildFilterStr({ contrast: 200 }), 'contrast(200%)'));
test('grayscale(100%)', () => assert.strictEqual(buildFilterStr({ grayscale: 100 }), 'grayscale(100%)'));
test('hue-rotate(180deg)', () => assert.strictEqual(buildFilterStr({ 'hue-rotate': 180 }), 'hue-rotate(180deg)'));
test('invert(50%)', () => assert.strictEqual(buildFilterStr({ invert: 50 }), 'invert(50%)'));
test('opacity(80%)', () => assert.strictEqual(buildFilterStr({ opacity: 80 }), 'opacity(80%)'));
test('saturate(200%)', () => assert.strictEqual(buildFilterStr({ saturate: 200 }), 'saturate(200%)'));
test('sepia(60%)', () => assert.strictEqual(buildFilterStr({ sepia: 60 }), 'sepia(60%)'));

console.log('\n[4] buildFilterStr — combinations');
test('blur + brightness', () => {
  const v = buildFilterStr({ blur: 12, brightness: 110 });
  assert(v.includes('blur(12px)'));
  assert(v.includes('brightness(110%)'));
});
test('frosted glass combination', () => {
  const v = buildFilterStr({ blur: 12, brightness: 110, saturate: 160 });
  assert(v.includes('blur(12px)'));
  assert(v.includes('brightness(110%)'));
  assert(v.includes('saturate(160%)'));
});
test('vintage combination', () => {
  const v = buildFilterStr({ sepia: 60, contrast: 110, brightness: 90, saturate: 80 });
  assert(v.includes('sepia(60%)'));
  assert(v.includes('contrast(110%)'));
});
test('noir combination', () => {
  const v = buildFilterStr({ grayscale: 100, contrast: 130, brightness: 80 });
  assert(v.includes('grayscale(100%)'));
  assert(v.includes('contrast(130%)'));
});
test('Multiple filters space-separated', () => {
  const v = buildFilterStr({ blur: 8, brightness: 80 });
  assert(v.includes(' '));
  assert(!v.includes(','));
});
test('Order follows FILTERS array order', () => {
  const v = buildFilterStr({ brightness: 110, blur: 12 });
  assert(v.indexOf('blur') < v.indexOf('brightness'));
});

console.log('\n[5] buildCSS output');
test('Empty: contains none', () => assert(buildCSS({}).includes('none')));
test('Empty: contains webkit prefix', () => assert(buildCSS({}).includes('-webkit-backdrop-filter')));
test('Active: contains backdrop-filter property', () => assert(buildCSS({ blur: 12 }).includes('backdrop-filter:')));
test('Active: contains -webkit-backdrop-filter', () => assert(buildCSS({ blur: 12 }).includes('-webkit-backdrop-filter:')));
test('Active: contains .element selector', () => assert(buildCSS({ blur: 12 }).includes('.element')));
test('Active: contains safari comment', () => assert(buildCSS({ blur: 12 }).includes('Safari')));
test('Active: both properties have same value', () => {
  const css = buildCSS({ blur: 12, brightness: 110 });
  const val = 'blur(12px) brightness(110%)';
  assert(css.split(val).length === 3); // appears twice
});

console.log('\n[6] buildFullCSS');
test('Full CSS contains background', () => assert(buildFullCSS({ blur: 12 }).includes('background:')));
test('Full CSS contains border', () => assert(buildFullCSS({ blur: 12 }).includes('border:')));
test('Full CSS contains border-radius', () => assert(buildFullCSS({ blur: 12 }).includes('border-radius:')));
test('Full CSS contains backdrop-filter', () => assert(buildFullCSS({ blur: 12 }).includes('backdrop-filter:')));
test('Full CSS contains -webkit- prefix', () => assert(buildFullCSS({ blur: 12 }).includes('-webkit-backdrop-filter:')));
test('Full CSS with none filter', () => assert(buildFullCSS({}).includes('none')));

// --- PRESETS validation ---
console.log('\n[7] PRESETS structure');
test('Has frosted preset', () => assert('frosted' in PRESETS));
test('Has dark preset', () => assert('dark' in PRESETS));
test('Has bright preset', () => assert('bright' in PRESETS));
test('Has vintage preset', () => assert('vintage' in PRESETS));
test('Has noir preset', () => assert('noir' in PRESETS));
test('Has reset preset (null)', () => assert(PRESETS.reset === null));

const presetKeys = ['frosted','dark','bright','vintage','noir'];
presetKeys.forEach(k => {
  const p = PRESETS[k];
  test(`Preset "${k}" is non-null`, () => assert(p !== null));
  test(`Preset "${k}" is non-empty`, () => assert(Object.keys(p).length > 0));
  Object.entries(p).forEach(([id, [val, active]]) => {
    test(`Preset "${k}" filter "${id}": value is number`, () => assert(typeof val === 'number'));
    test(`Preset "${k}" filter "${id}": active is boolean`, () => assert(typeof active === 'boolean'));
    const filterDef = FILTERS.find(f => f.id === id);
    test(`Preset "${k}" filter "${id}": exists in FILTERS`, () => assert(filterDef !== undefined));
    test(`Preset "${k}" filter "${id}": value in range`, () => assert(val >= filterDef.min && val <= filterDef.max));
  });
});

// --- Preset output quality ---
console.log('\n[8] Preset CSS output quality');
presetKeys.forEach(k => {
  const p = PRESETS[k];
  const active = {};
  Object.entries(p).forEach(([id, [val, on]]) => { if (on) active[id] = val; });
  const v = buildFilterStr(active);
  test(`Preset "${k}" filter string is not "none"`, () => assert(v !== 'none'));
  test(`Preset "${k}" filter string has no trailing space`, () => assert(!v.endsWith(' ')));
  test(`Preset "${k}" CSS contains both properties`, () => {
    const css = buildCSS(active);
    assert(css.includes('backdrop-filter:') && css.includes('-webkit-backdrop-filter:'));
  });
});

// --- Unit tests ---
console.log('\n[9] Unit correctness');
const unitFilters = FILTERS.filter(f => f.unit !== '%');
test('blur uses px unit', () => assert(FILTERS.find(f=>f.id==='blur').unit === 'px'));
test('hue-rotate uses deg unit', () => assert(FILTERS.find(f=>f.id==='hue-rotate').unit === 'deg'));
test('brightness uses % unit', () => assert(FILTERS.find(f=>f.id==='brightness').unit === '%'));
test('blur output has px', () => assert(buildFilterStr({ blur: 5 }).includes('px')));
test('hue-rotate output has deg', () => assert(buildFilterStr({ 'hue-rotate': 90 }).includes('deg')));
test('sepia output has %', () => assert(buildFilterStr({ sepia: 50 }).includes('%')));

// --- Max values ---
console.log('\n[10] Range checks');
test('blur max is 40', () => assert.strictEqual(FILTERS.find(f=>f.id==='blur').max, 40));
test('hue-rotate max is 360', () => assert.strictEqual(FILTERS.find(f=>f.id==='hue-rotate').max, 360));
test('saturate max is 300', () => assert.strictEqual(FILTERS.find(f=>f.id==='saturate').max, 300));
test('brightness max is 200', () => assert.strictEqual(FILTERS.find(f=>f.id==='brightness').max, 200));
test('grayscale max is 100', () => assert.strictEqual(FILTERS.find(f=>f.id==='grayscale').max, 100));
test('invert max is 100', () => assert.strictEqual(FILTERS.find(f=>f.id==='invert').max, 100));
test('sepia max is 100', () => assert.strictEqual(FILTERS.find(f=>f.id==='sepia').max, 100));
test('opacity max is 100', () => assert.strictEqual(FILTERS.find(f=>f.id==='opacity').max, 100));
test('blur def is 0', () => assert.strictEqual(FILTERS.find(f=>f.id==='blur').def, 0));
test('brightness def is 100', () => assert.strictEqual(FILTERS.find(f=>f.id==='brightness').def, 100));

console.log(`\n✅ All ${passed} tests passed\n`);
