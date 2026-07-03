const assert = require('assert');

// Core logic extracted from cors-generator

function buildHeaders(cfg, requestOrigin) {
  const origin = cfg.isStar ? '*' : (requestOrigin || cfg.origins[0] || '*');
  const h = {};
  h['Access-Control-Allow-Origin'] = origin;
  if (!cfg.isStar && cfg.origins.length > 1) h['Vary'] = 'Origin';
  if (cfg.creds && !cfg.isStar) h['Access-Control-Allow-Credentials'] = 'true';
  if (cfg.methods.length) h['Access-Control-Allow-Methods'] = cfg.methods.join(', ');
  if (cfg.allHeaders.length) h['Access-Control-Allow-Headers'] = cfg.allHeaders.join(', ');
  if (cfg.expose.length) h['Access-Control-Expose-Headers'] = cfg.expose.join(', ');
  if (cfg.maxAge > 0) h['Access-Control-Max-Age'] = String(cfg.maxAge);
  return h;
}

function genExpress(cfg) {
  const multiOrigin = !cfg.isStar && cfg.origins.length > 1;
  const allowedOrigins = cfg.origins.map(o => `'${o}'`).join(', ');
  let code = `const cors = require('cors');\n\n`;
  if (multiOrigin) {
    code += `const ALLOWED_ORIGINS = [${allowedOrigins}];\n\n`;
    code += `const corsOptions = {\n  origin: (origin, callback) => {\n    if (!origin || ALLOWED_ORIGINS.includes(origin)) {\n      callback(null, true);\n    } else {\n      callback(new Error('CORS not allowed'));\n    }\n  },\n`;
  } else {
    code += `const corsOptions = {\n  origin: '${cfg.isStar ? '*' : cfg.origins[0] || '*'}',\n`;
  }
  if (cfg.creds) code += `  credentials: true,\n`;
  if (cfg.methods.length) code += `  methods: [${cfg.methods.map(m => `'${m}'`).join(', ')}],\n`;
  if (cfg.allHeaders.length) code += `  allowedHeaders: [${cfg.allHeaders.map(h => `'${h}'`).join(', ')}],\n`;
  if (cfg.expose.length) code += `  exposedHeaders: [${cfg.expose.map(h => `'${h}'`).join(', ')}],\n`;
  if (cfg.maxAge > 0) code += `  maxAge: ${cfg.maxAge},\n`;
  code += `};\n\napp.use(cors(corsOptions));\n\n`;
  code += `// Handle preflight requests\napp.options('*', cors(corsOptions));`;
  return code;
}

function genNginx(cfg) {
  const multiOrigin = !cfg.isStar && cfg.origins.length > 1;
  let code = `# nginx CORS configuration\n# Add inside your server {} or location {} block\n\n`;
  if (multiOrigin) {
    code += `set $cors_origin "";\n`;
    cfg.origins.forEach((o, i) => {
      code += `if ($http_origin = "${o}") { set $cors_origin "$http_origin"; }\n`;
    });
    code += `\nadd_header Access-Control-Allow-Origin $cors_origin always;\nadd_header Vary Origin always;\n`;
  } else {
    code += `add_header Access-Control-Allow-Origin "${cfg.isStar ? '*' : cfg.origins[0] || '*'}" always;\n`;
  }
  if (cfg.creds && !cfg.isStar) code += `add_header Access-Control-Allow-Credentials "true" always;\n`;
  if (cfg.methods.length) code += `add_header Access-Control-Allow-Methods "${cfg.methods.join(', ')}" always;\n`;
  if (cfg.allHeaders.length) code += `add_header Access-Control-Allow-Headers "${cfg.allHeaders.join(', ')}" always;\n`;
  if (cfg.expose.length) code += `add_header Access-Control-Expose-Headers "${cfg.expose.join(', ')}" always;\n`;
  if (cfg.maxAge > 0) code += `add_header Access-Control-Max-Age "${cfg.maxAge}" always;\n`;
  code += `\n# Handle OPTIONS preflight\nif ($request_method = OPTIONS) {\n  add_header Content-Length 0;\n  add_header Content-Type text/plain;\n  return 204;\n}`;
  return code;
}

function genRaw(cfg) {
  const h = buildHeaders(cfg);
  return Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n');
}

let passed = 0;
function test(desc, fn) {
  try { fn(); passed++; console.log(`  ✓ ${desc}`); }
  catch(e) { console.error(`  ✗ ${desc}: ${e.message}`); process.exit(1); }
}

// --- buildHeaders tests ---
console.log('\n[1] buildHeaders — wildcard origin');
const starCfg = { origins: ['*'], isStar: true, creds: false, methods: ['GET', 'POST'], allHeaders: ['Content-Type'], expose: [], maxAge: 0 };
const starH = buildHeaders(starCfg);
test('Allow-Origin is *', () => assert.strictEqual(starH['Access-Control-Allow-Origin'], '*'));
test('No Vary header for wildcard', () => assert.strictEqual(starH['Vary'], undefined));
test('No Credentials for wildcard', () => assert.strictEqual(starH['Access-Control-Allow-Credentials'], undefined));
test('Methods included', () => assert.strictEqual(starH['Access-Control-Allow-Methods'], 'GET, POST'));
test('Headers included', () => assert.strictEqual(starH['Access-Control-Allow-Headers'], 'Content-Type'));
test('No Max-Age when 0', () => assert.strictEqual(starH['Access-Control-Max-Age'], undefined));
test('No Expose when empty', () => assert.strictEqual(starH['Access-Control-Expose-Headers'], undefined));

console.log('\n[2] buildHeaders — single origin with credentials');
const singleCfg = { origins: ['https://app.example.com'], isStar: false, creds: true, methods: ['GET', 'POST', 'PUT'], allHeaders: ['Content-Type', 'Authorization'], expose: ['X-Total-Count'], maxAge: 3600 };
const singleH = buildHeaders(singleCfg);
test('Allow-Origin is the specified origin', () => assert.strictEqual(singleH['Access-Control-Allow-Origin'], 'https://app.example.com'));
test('Credentials set to true', () => assert.strictEqual(singleH['Access-Control-Allow-Credentials'], 'true'));
test('Methods string correct', () => assert.strictEqual(singleH['Access-Control-Allow-Methods'], 'GET, POST, PUT'));
test('Headers string correct', () => assert.strictEqual(singleH['Access-Control-Allow-Headers'], 'Content-Type, Authorization'));
test('Expose-Headers set', () => assert.strictEqual(singleH['Access-Control-Expose-Headers'], 'X-Total-Count'));
test('Max-Age set', () => assert.strictEqual(singleH['Access-Control-Max-Age'], '3600'));
test('No Vary for single origin', () => assert.strictEqual(singleH['Vary'], undefined));

console.log('\n[3] buildHeaders — multiple origins');
const multiCfg = { origins: ['https://a.com', 'https://b.com'], isStar: false, creds: true, methods: ['GET'], allHeaders: [], expose: [], maxAge: 0 };
const multiH = buildHeaders(multiCfg);
test('Vary set for multi-origin', () => assert.strictEqual(multiH['Vary'], 'Origin'));
test('Allow-Origin defaults to first origin', () => assert.strictEqual(multiH['Access-Control-Allow-Origin'], 'https://a.com'));
test('Creds set when not wildcard', () => assert.strictEqual(multiH['Access-Control-Allow-Credentials'], 'true'));

console.log('\n[4] buildHeaders — wildcard + credentials (invalid spec)');
const badCfg = { origins: ['*'], isStar: true, creds: true, methods: ['GET'], allHeaders: [], expose: [], maxAge: 0 };
const badH = buildHeaders(badCfg);
test('Origin is still * even with creds', () => assert.strictEqual(badH['Access-Control-Allow-Origin'], '*'));
test('Credentials NOT set when origin is *', () => assert.strictEqual(badH['Access-Control-Allow-Credentials'], undefined));

console.log('\n[5] buildHeaders — empty methods and headers');
const emptyCfg = { origins: ['https://x.com'], isStar: false, creds: false, methods: [], allHeaders: [], expose: [], maxAge: 0 };
const emptyH = buildHeaders(emptyCfg);
test('No Allow-Methods when empty', () => assert.strictEqual(emptyH['Access-Control-Allow-Methods'], undefined));
test('No Allow-Headers when empty', () => assert.strictEqual(emptyH['Access-Control-Allow-Headers'], undefined));

console.log('\n[6] buildHeaders — requestOrigin override');
const dynCfg = { origins: ['https://a.com', 'https://b.com'], isStar: false, creds: false, methods: ['GET'], allHeaders: [], expose: [], maxAge: 0 };
const dynH = buildHeaders(dynCfg, 'https://b.com');
test('Allow-Origin reflects request origin', () => assert.strictEqual(dynH['Access-Control-Allow-Origin'], 'https://b.com'));

console.log('\n[7] buildHeaders — max-age variants');
const ma0 = buildHeaders({ ...singleCfg, maxAge: 0 });
const ma86400 = buildHeaders({ ...singleCfg, maxAge: 86400 });
const ma1 = buildHeaders({ ...singleCfg, maxAge: 1 });
test('maxAge 0 → not included', () => assert.strictEqual(ma0['Access-Control-Max-Age'], undefined));
test('maxAge 86400 → "86400"', () => assert.strictEqual(ma86400['Access-Control-Max-Age'], '86400'));
test('maxAge 1 → "1"', () => assert.strictEqual(ma1['Access-Control-Max-Age'], '1'));

console.log('\n[8] genExpress tests');
const exCfg = { origins: ['https://example.com'], isStar: false, creds: true, methods: ['GET', 'POST'], allHeaders: ['Content-Type'], expose: [], maxAge: 3600 };
const exCode = genExpress(exCfg);
test('Express: contains require cors', () => assert(exCode.includes("require('cors')")));
test('Express: contains origin', () => assert(exCode.includes('https://example.com')));
test('Express: contains credentials: true', () => assert(exCode.includes('credentials: true')));
test('Express: contains maxAge', () => assert(exCode.includes('maxAge: 3600')));
test('Express: contains app.use(cors', () => assert(exCode.includes('app.use(cors')));
test('Express: contains app.options', () => assert(exCode.includes("app.options('*'")));
test('Express: methods included', () => assert(exCode.includes("'GET'")));
test('Express: allowedHeaders included', () => assert(exCode.includes('allowedHeaders')));

const exStar = genExpress({ ...starCfg, creds: false });
test('Express wildcard: origin is *', () => assert(exStar.includes("origin: '*'")));
test('Express wildcard: no credentials', () => assert(!exStar.includes('credentials: true')));

const exMulti = genExpress({ origins: ['https://a.com', 'https://b.com'], isStar: false, creds: false, methods: ['GET'], allHeaders: [], expose: [], maxAge: 0 });
test('Express multi: uses ALLOWED_ORIGINS array', () => assert(exMulti.includes('ALLOWED_ORIGINS')));
test('Express multi: origin callback', () => assert(exMulti.includes('callback')));

console.log('\n[9] genNginx tests');
const nxCfg = { origins: ['https://example.com'], isStar: false, creds: false, methods: ['GET', 'POST'], allHeaders: ['Content-Type', 'Authorization'], expose: ['X-Count'], maxAge: 600 };
const nxCode = genNginx(nxCfg);
test('nginx: contains add_header', () => assert(nxCode.includes('add_header')));
test('nginx: contains Allow-Origin', () => assert(nxCode.includes('Access-Control-Allow-Origin')));
test('nginx: contains always', () => assert(nxCode.includes('always')));
test('nginx: contains OPTIONS block', () => assert(nxCode.includes('OPTIONS')));
test('nginx: contains return 204', () => assert(nxCode.includes('return 204')));
test('nginx: expose headers included', () => assert(nxCode.includes('X-Count')));
test('nginx: max-age included', () => assert(nxCode.includes('600')));
test('nginx: methods included', () => assert(nxCode.includes('GET, POST')));
test('nginx: allow headers included', () => assert(nxCode.includes('Content-Type, Authorization')));

const nxStar = genNginx(starCfg);
test('nginx wildcard: origin is *', () => assert(nxStar.includes('"*"')));

const nxMulti = genNginx({ origins: ['https://a.com', 'https://b.com'], isStar: false, creds: false, methods: ['GET'], allHeaders: [], expose: [], maxAge: 0 });
test('nginx multi: uses $cors_origin variable', () => assert(nxMulti.includes('$cors_origin')));
test('nginx multi: contains both origins', () => assert(nxMulti.includes('https://a.com') && nxMulti.includes('https://b.com')));

console.log('\n[10] genRaw tests');
const rawCode = genRaw(singleCfg);
test('raw: contains ACAO header', () => assert(rawCode.includes('Access-Control-Allow-Origin:')));
test('raw: contains ACAC header', () => assert(rawCode.includes('Access-Control-Allow-Credentials:')));
test('raw: contains ACAM header', () => assert(rawCode.includes('Access-Control-Allow-Methods:')));
test('raw: newline separated', () => assert(rawCode.includes('\n')));
test('raw: no HTML', () => assert(!rawCode.includes('<')));

console.log('\n[11] Edge cases');
const noMethodsCfg = { origins: ['https://a.com'], isStar: false, creds: false, methods: [], allHeaders: [], expose: [], maxAge: 0 };
const noMethodsH = buildHeaders(noMethodsCfg);
test('No methods → no Allow-Methods header', () => assert(!('Access-Control-Allow-Methods' in noMethodsH)));

const exposeCfg = { origins: ['https://a.com'], isStar: false, creds: false, methods: ['GET'], allHeaders: [], expose: ['X-Total-Count', 'X-Request-Id'], maxAge: 0 };
const exposeH = buildHeaders(exposeCfg);
test('Expose headers: both present', () => assert(exposeH['Access-Control-Expose-Headers'].includes('X-Total-Count')));
test('Expose headers: comma separated', () => assert(exposeH['Access-Control-Expose-Headers'].includes(', ')));

const longMaxAge = buildHeaders({ ...singleCfg, maxAge: 86400 });
test('Max-Age 86400 is string', () => assert.strictEqual(typeof longMaxAge['Access-Control-Max-Age'], 'string'));

console.log(`\n✅ All ${passed} tests passed\n`);
