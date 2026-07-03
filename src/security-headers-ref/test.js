const assert = require('assert');

const HEADERS = [
  { name: 'Strict-Transport-Security', abbr: 'HSTS', risk: 'Critical', cat: 'Transport', desc: 'Tells browsers to only connect to your site over HTTPS for a specified duration. Once received, the browser refuses HTTP connections for the site and all subdomains (with includeSubDomains). Prevents SSL-stripping attacks and protocol downgrade attacks.', attacks: ['SSL stripping', 'Protocol downgrade', 'Man-in-the-middle (MitM)'], recommended: 'max-age=31536000; includeSubDomains; preload', notes: ['Start with max-age=300, increase to 31536000 after confirming HTTPS is stable.', '"preload" requires registration at hstspreload.org — browsers bundle your domain.', '"includeSubDomains" applies to all subdomains; ensure they all serve HTTPS.', 'Only sent over HTTPS — ignored over HTTP connections.'], snippets: { express: "app.use((req, res, next) => {\n  res.setHeader('Strict-Transport-Security',\n    'max-age=31536000; includeSubDomains; preload');\n  next();\n});", nginx: 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;', apache: 'Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"' } },
  { name: 'Content-Security-Policy', abbr: 'CSP', risk: 'Critical', cat: 'Content', desc: "Defines which content sources are trusted for scripts, styles, images, frames, and other resources. Prevents Cross-Site Scripting (XSS) and data injection attacks by controlling what the browser is allowed to load.", attacks: ['Cross-Site Scripting (XSS)', 'Data injection', 'Clickjacking (via frame-ancestors)', 'MIME sniffing'], recommended: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'", notes: ["Use 'nonce-{random}' or hashes instead of 'unsafe-inline' for scripts.", "Use Content-Security-Policy-Report-Only to test without enforcing.", '"frame-ancestors" replaces X-Frame-Options in modern browsers.', 'Start strict and loosen based on report-uri / report-to violations.'], snippets: { express: "app.use((req, res, next) => {\n  res.setHeader('Content-Security-Policy',\n    \"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'\");\n  next();\n});", nginx: "add_header Content-Security-Policy \"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'\" always;", apache: "Header always set Content-Security-Policy \"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'\"" } },
  { name: 'X-Frame-Options', abbr: 'XFO', risk: 'High', cat: 'Content', desc: 'Controls whether a browser should allow a page to be displayed in a frame, iframe, embed, or object. Prevents clickjacking attacks.', attacks: ['Clickjacking', 'UI redressing'], recommended: 'DENY', notes: ['"DENY" prevents all framing.', '"SAMEORIGIN" allows framing only from the same origin.', '"ALLOW-FROM uri" is deprecated and not supported by Chrome/Firefox.', 'Use CSP frame-ancestors for modern browsers (with XFO as fallback).'], snippets: { express: "app.use((req, res, next) => {\n  res.setHeader('X-Frame-Options', 'DENY');\n  next();\n});", nginx: 'add_header X-Frame-Options "DENY" always;', apache: 'Header always set X-Frame-Options "DENY"' } },
  { name: 'X-Content-Type-Options', abbr: 'XCTO', risk: 'High', cat: 'Content', desc: 'Prevents browsers from MIME-sniffing a response away from the declared Content-Type.', attacks: ['MIME confusion attacks', 'Drive-by downloads', 'XSS via MIME sniffing'], recommended: 'nosniff', notes: ['"nosniff" is the only valid value.', 'Ensures scripts and stylesheets are only loaded if they have correct MIME type.', 'Required for all resources, not just HTML pages.', 'Easy to add — no known compatibility issues.'], snippets: { express: "app.use((req, res, next) => {\n  res.setHeader('X-Content-Type-Options', 'nosniff');\n  next();\n});", nginx: 'add_header X-Content-Type-Options "nosniff" always;', apache: 'Header always set X-Content-Type-Options "nosniff"' } },
  { name: 'Referrer-Policy', abbr: 'RP', risk: 'Medium', cat: 'Privacy', desc: 'Controls how much referrer information is included with requests.', attacks: ['Information leakage', 'Session token leakage in URLs'], recommended: 'strict-origin-when-cross-origin', notes: ['"no-referrer" sends no referrer at all — safest for privacy.', '"strict-origin-when-cross-origin" sends full URL for same-origin, only origin for cross-origin.', '"no-referrer-when-downgrade" leaks referrer for HTTP→HTTPS (avoid).', 'Combine with HTTPS to prevent referrer from revealing sensitive URL parameters.'], snippets: { express: "app.use((req, res, next) => {\n  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');\n  next();\n});", nginx: 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;', apache: 'Header always set Referrer-Policy "strict-origin-when-cross-origin"' } },
  { name: 'Permissions-Policy', abbr: 'PP', risk: 'Medium', cat: 'Browser Features', desc: 'Restricts which browser features and APIs can be used in the document and embedded iframes.', attacks: ['Abuse of device APIs', 'Unauthorized resource access'], recommended: 'camera=(), microphone=(), geolocation=(), payment=()', notes: ['Use empty parentheses "()" to completely disable a feature.', '"self" allows the feature only on the page itself (not iframes).', 'Use "Permissions-Policy-Report-Only" to audit without blocking.', 'Replaces the deprecated "Feature-Policy" header.'], snippets: { express: "app.use((req, res, next) => {\n  res.setHeader('Permissions-Policy',\n    'camera=(), microphone=(), geolocation=(), payment=()');\n  next();\n});", nginx: 'add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;', apache: 'Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"' } },
  { name: 'Cross-Origin-Embedder-Policy', abbr: 'COEP', risk: 'Medium', cat: 'Cross-Origin', desc: 'Requires all cross-origin resources to explicitly opt in to being loaded.', attacks: ['Spectre-style side-channel attacks', 'Cross-origin data leakage'], recommended: 'require-corp', notes: ['"require-corp" blocks cross-origin resources that do not set CORP or CORS.', '"credentialless" is a relaxed alternative: loads resources without credentials.', 'Must be paired with COOP: same-origin to enable cross-origin isolation.', 'Required for SharedArrayBuffer and performance.measureUserAgentSpecificMemory().'], snippets: { express: "app.use((req, res, next) => {\n  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');\n  next();\n});", nginx: 'add_header Cross-Origin-Embedder-Policy "require-corp" always;', apache: 'Header always set Cross-Origin-Embedder-Policy "require-corp"' } },
  { name: 'Cross-Origin-Opener-Policy', abbr: 'COOP', risk: 'Medium', cat: 'Cross-Origin', desc: 'Controls how documents opened from your site are connected in the browsing context group.', attacks: ['XS-Leaks', 'Cross-window hijacking', 'Spectre-style side-channel'], recommended: 'same-origin', notes: ['"same-origin" provides the strongest isolation.', '"same-origin-allow-popups" allows window.open() to work across origins.', 'Required with COEP for cross-origin isolation (SharedArrayBuffer, etc.).', '"unsafe-none" (default) applies no restrictions.'], snippets: { express: "app.use((req, res, next) => {\n  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');\n  next();\n});", nginx: 'add_header Cross-Origin-Opener-Policy "same-origin" always;', apache: 'Header always set Cross-Origin-Opener-Policy "same-origin"' } },
  { name: 'Cross-Origin-Resource-Policy', abbr: 'CORP', risk: 'Medium', cat: 'Cross-Origin', desc: 'Prevents other origins from loading your resources in their pages.', attacks: ['Cross-origin resource leakage', 'Spectre side-channel'], recommended: 'same-origin', notes: ['"same-origin" blocks all cross-origin loads of this resource.', '"same-site" allows subdomains to load the resource.', '"cross-origin" explicitly allows cross-origin loads (opt-in).', 'Apply to: API endpoints and sensitive resources — not to public CDN assets.'], snippets: { express: "app.use((req, res, next) => {\n  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');\n  next();\n});", nginx: 'add_header Cross-Origin-Resource-Policy "same-origin" always;', apache: 'Header always set Cross-Origin-Resource-Policy "same-origin"' } },
  { name: 'X-XSS-Protection', abbr: 'XSS', risk: 'Low', cat: 'Content', desc: 'Activates the built-in XSS filter in older browsers. Largely obsolete now that modern browsers have removed their XSS auditors.', attacks: ['Reflected XSS (in legacy browsers)'], recommended: '0', notes: ['Modern Chrome and Firefox have removed the XSS auditor entirely.', '"1; mode=block" could introduce vulnerabilities by blocking page rendering.', 'Prefer CSP over X-XSS-Protection for XSS protection.', 'Set to "0" if you have a strong CSP to avoid legacy browser issues.'], snippets: { express: "app.use((req, res, next) => {\n  res.setHeader('X-XSS-Protection', '0'); // disabled in favor of CSP\n  next();\n});", nginx: 'add_header X-XSS-Protection "0" always; # Use CSP instead', apache: 'Header always set X-XSS-Protection "0" # Use CSP instead' } },
  { name: 'Cache-Control', abbr: 'CC', risk: 'Low', cat: 'Privacy', desc: 'For authenticated or sensitive responses, setting Cache-Control prevents shared caches from storing private data.', attacks: ['Cache poisoning', 'Sensitive data exposure via shared caches'], recommended: 'no-store, private', notes: ['For public static assets, caching is fine and expected.', '"private" restricts to the user\'s browser only (no CDN/proxy caching).', '"no-store" prevents all storage, including in browser history.', 'Apply to: account pages, API responses with personal data, session endpoints.'], snippets: { express: "// For authenticated routes:\napp.use('/api/secure', (req, res, next) => {\n  res.setHeader('Cache-Control', 'no-store, private');\n  next();\n});", nginx: '# In location block for authenticated routes:\nadd_header Cache-Control "no-store, private" always;', apache: '# In Directory or Location block:\nHeader always set Cache-Control "no-store, private"' } },
];

const RISK_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const VALID_RISKS = ['Critical', 'High', 'Medium', 'Low'];
const VALID_CATS = ['Transport', 'Content', 'Privacy', 'Cross-Origin', 'Browser Features'];

let passed = 0;
function test(desc, fn) {
  try { fn(); passed++; console.log(`  ✓ ${desc}`); }
  catch(e) { console.error(`  ✗ ${desc}: ${e.message}`); process.exit(1); }
}

// --- Structure tests ---
console.log('\n[1] HEADERS structure');
test('Is array', () => assert(Array.isArray(HEADERS)));
test('Has 11 security headers', () => assert.strictEqual(HEADERS.length, 11));

console.log('\n[2] Required fields on every entry');
HEADERS.forEach((h, i) => {
  test(`[${i}] ${h.name}: has name`, () => assert(typeof h.name === 'string' && h.name.length > 0));
  test(`[${i}] ${h.name}: has abbr`, () => assert(typeof h.abbr === 'string' && h.abbr.length > 0));
  test(`[${i}] ${h.name}: risk is valid`, () => assert(VALID_RISKS.includes(h.risk)));
  test(`[${i}] ${h.name}: cat is valid`, () => assert(VALID_CATS.includes(h.cat)));
  test(`[${i}] ${h.name}: desc length >= 30`, () => assert(h.desc.length >= 30));
  test(`[${i}] ${h.name}: attacks is non-empty array`, () => assert(Array.isArray(h.attacks) && h.attacks.length > 0));
  test(`[${i}] ${h.name}: recommended is non-empty string`, () => assert(typeof h.recommended === 'string' && h.recommended.length > 0));
  test(`[${i}] ${h.name}: notes is array with >= 3 items`, () => assert(Array.isArray(h.notes) && h.notes.length >= 3));
  test(`[${i}] ${h.name}: snippets has express`, () => assert(typeof h.snippets.express === 'string' && h.snippets.express.length > 0));
  test(`[${i}] ${h.name}: snippets has nginx`, () => assert(typeof h.snippets.nginx === 'string' && h.snippets.nginx.length > 0));
  test(`[${i}] ${h.name}: snippets has apache`, () => assert(typeof h.snippets.apache === 'string' && h.snippets.apache.length > 0));
});

// --- Specific headers present ---
console.log('\n[3] Specific headers required');
const headerNames = new Set(HEADERS.map(h => h.name));
const required = ['Strict-Transport-Security', 'Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Embedder-Policy', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy', 'X-XSS-Protection', 'Cache-Control'];
required.forEach(name => {
  test(`Contains "${name}"`, () => assert(headerNames.has(name)));
});

// --- No duplicates ---
console.log('\n[4] No duplicate names');
test('All header names are unique', () => assert.strictEqual(new Set(HEADERS.map(h=>h.name)).size, HEADERS.length));
test('All abbrs are unique', () => assert.strictEqual(new Set(HEADERS.map(h=>h.abbr)).size, HEADERS.length));

// --- Risk distribution ---
console.log('\n[5] Risk distribution');
const byRisk = {};
HEADERS.forEach(h => { byRisk[h.risk] = (byRisk[h.risk] || 0) + 1; });
test('At least 2 Critical headers', () => assert(byRisk.Critical >= 2));
test('At least 1 High header', () => assert(byRisk.High >= 1));
test('At least 1 Medium header', () => assert(byRisk.Medium >= 1));
test('At least 1 Low header', () => assert(byRisk.Low >= 1));

// --- Specific recommended values ---
console.log('\n[6] Recommended values');
const getH = name => HEADERS.find(h => h.name === name);
test('HSTS recommended contains max-age', () => assert(getH('Strict-Transport-Security').recommended.includes('max-age=')));
test('HSTS recommended contains includeSubDomains', () => assert(getH('Strict-Transport-Security').recommended.includes('includeSubDomains')));
test('HSTS recommended contains preload', () => assert(getH('Strict-Transport-Security').recommended.includes('preload')));
test('CSP recommended contains default-src', () => assert(getH('Content-Security-Policy').recommended.includes('default-src')));
test("CSP recommended contains frame-ancestors", () => assert(getH('Content-Security-Policy').recommended.includes('frame-ancestors')));
test('X-Frame-Options recommended is DENY', () => assert.strictEqual(getH('X-Frame-Options').recommended, 'DENY'));
test('X-Content-Type-Options recommended is nosniff', () => assert.strictEqual(getH('X-Content-Type-Options').recommended, 'nosniff'));
test('X-XSS-Protection recommended is 0', () => assert.strictEqual(getH('X-XSS-Protection').recommended, '0'));
test('COEP recommended is require-corp', () => assert.strictEqual(getH('Cross-Origin-Embedder-Policy').recommended, 'require-corp'));
test('COOP recommended is same-origin', () => assert.strictEqual(getH('Cross-Origin-Opener-Policy').recommended, 'same-origin'));
test('CORP recommended is same-origin', () => assert.strictEqual(getH('Cross-Origin-Resource-Policy').recommended, 'same-origin'));
test('Permissions-Policy recommended contains camera=()', () => assert(getH('Permissions-Policy').recommended.includes('camera=()')));

// --- Snippet quality ---
console.log('\n[7] Snippet quality');
HEADERS.forEach(h => {
  test(`${h.name} express snippet contains header name`, () => assert(h.snippets.express.includes(h.name)));
  test(`${h.name} nginx snippet contains add_header`, () => assert(h.snippets.nginx.includes('add_header')));
  test(`${h.name} apache snippet contains Header`, () => assert(h.snippets.apache.includes('Header')));
  test(`${h.name} nginx snippet contains always`, () => assert(h.snippets.nginx.includes('always')));
  test(`${h.name} nginx snippet contains header name`, () => assert(h.snippets.nginx.includes(h.name)));
});

// --- Attack lists ---
console.log('\n[8] Attack lists');
HEADERS.forEach(h => {
  test(`${h.name}: all attacks are non-empty strings`, () => h.attacks.forEach(a => assert(typeof a === 'string' && a.length > 0)));
});
test('HSTS mitigates MitM', () => assert(getH('Strict-Transport-Security').attacks.some(a => a.includes('Man-in-the-middle'))));
test('CSP mitigates XSS', () => assert(getH('Content-Security-Policy').attacks.some(a => a.includes('XSS'))));
test('X-Frame-Options mitigates clickjacking', () => assert(getH('X-Frame-Options').attacks.some(a => a.toLowerCase().includes('clickjacking'))));

// --- RISK_ORDER ---
console.log('\n[9] RISK_ORDER correctness');
test('Critical < High', () => assert(RISK_ORDER.Critical < RISK_ORDER.High));
test('High < Medium', () => assert(RISK_ORDER.High < RISK_ORDER.Medium));
test('Medium < Low', () => assert(RISK_ORDER.Medium < RISK_ORDER.Low));

// --- Sorting ---
console.log('\n[10] Sort order');
const sorted = [...HEADERS].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);
test('First sorted header is Critical', () => assert(sorted[0].risk === 'Critical'));
test('Last sorted header is Low', () => assert(sorted[sorted.length - 1].risk === 'Low'));
test('All Critical before High', () => {
  const critEnd = sorted.map(h=>h.risk).lastIndexOf('Critical');
  const highStart = sorted.map(h=>h.risk).indexOf('High');
  assert(critEnd < highStart);
});
test('All High before Medium', () => {
  const highEnd = sorted.map(h=>h.risk).lastIndexOf('High');
  const medStart = sorted.map(h=>h.risk).indexOf('Medium');
  assert(highEnd < medStart);
});

console.log(`\n✅ All ${passed} tests passed\n`);
