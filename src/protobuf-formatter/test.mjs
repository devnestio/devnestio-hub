import assert from 'node:assert/strict';

// ── Core logic extracted from index.html ──────────────────────────────────────

const PROTO_TYPES = new Set([
  'double','float','int32','int64','uint32','uint64','sint32','sint64',
  'fixed32','fixed64','sfixed32','sfixed64','bool','string','bytes',
]);
const PROTO_KEYWORDS = new Set([
  'syntax','package','import','option','message','enum','service','rpc',
  'returns','repeated','optional','required','oneof','map','reserved',
  'extensions','weak','public','stream',
]);

function formatProto(src) {
  const lines = src.split('\n');
  const out = [];
  let indent = 0;
  const INDENT = '  ';
  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') { out.push(''); continue; }
    if (line === '}' || line === '};') {
      indent = Math.max(0, indent - 1);
      out.push(INDENT.repeat(indent) + line);
      continue;
    }
    out.push(INDENT.repeat(indent) + line);
    if (line.endsWith('{')) indent++;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function validate(src) {
  const issues = [];
  const lines = src.split('\n');
  if (!src.includes('syntax = "proto3"') && !src.includes("syntax = 'proto3'") &&
      !src.includes('syntax = "proto2"') && !src.includes("syntax = 'proto2'")) {
    issues.push({ type: 'warn', msg: 'No syntax declaration found' });
  }
  const msgStack = [];
  const fieldNums = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//')) continue;
    const msgMatch = line.match(/^message\s+(\w+)\s*\{/);
    if (msgMatch) { msgStack.push(msgMatch[1]); fieldNums[msgMatch[1]] = new Set(); }
    const enumMatch = line.match(/^enum\s+(\w+)\s*\{/);
    if (enumMatch) { msgStack.push('__enum__' + enumMatch[1]); }
    if (line === '}' || line === '};') { msgStack.pop(); }
    const fieldMatch = line.match(/^(?:repeated\s+|optional\s+|required\s+)?[\w.]+\s+\w+\s*=\s*(\d+)\s*[;{]/);
    if (fieldMatch && msgStack.length > 0) {
      const ctx = msgStack[msgStack.length - 1];
      if (!ctx.startsWith('__enum__')) {
        const num = parseInt(fieldMatch[1], 10);
        if (num <= 0) issues.push({ type: 'error', msg: `Line ${i+1}: Field number must be positive` });
        if (num >= 19000 && num <= 19999) issues.push({ type: 'warn', msg: `Line ${i+1}: Reserved field number range` });
        if (fieldNums[ctx] && fieldNums[ctx].has(num)) issues.push({ type: 'error', msg: `Line ${i+1}: Duplicate field number ${num}` });
        if (fieldNums[ctx]) fieldNums[ctx].add(num);
      }
    }
    if (line.startsWith('import') && !line.endsWith(';')) {
      issues.push({ type: 'warn', msg: `Line ${i+1}: Import missing semicolon` });
    }
    const fieldNameMatch = line.match(/^(?:repeated\s+|optional\s+|required\s+)?[\w.]+\s+([a-zA-Z_]\w*)\s*=/);
    if (fieldNameMatch && !line.match(/^\s*(message|enum|service|rpc|option|syntax|package|import)/)) {
      const name = fieldNameMatch[1];
      if (/[A-Z]/.test(name)) issues.push({ type: 'warn', msg: `Line ${i+1}: Field "${name}" should use snake_case` });
    }
  }
  if (issues.filter(i => i.type === 'error').length === 0) issues.push({ type: 'ok', msg: 'No errors found' });
  return issues;
}

function extractStructure(src) {
  const items = [];
  const lines = src.split('\n');
  const stack = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('//')) continue;
    const msgM = t.match(/^message\s+(\w+)/);
    const enumM = t.match(/^enum\s+(\w+)/);
    const svcM = t.match(/^service\s+(\w+)/);
    const rpcM = t.match(/^rpc\s+(\w+)\s*\(([^)]+)\)\s*returns\s*\(([^)]+)\)/);
    const fieldM = t.match(/^(?:repeated\s+|optional\s+|required\s+)?([\w.]+)\s+(\w+)\s*=\s*(\d+)/);
    if (msgM) { items.push({ kind:'message', name: msgM[1], depth: stack.length }); stack.push('message'); }
    else if (enumM) { items.push({ kind:'enum', name: enumM[1], depth: stack.length }); stack.push('enum'); }
    else if (svcM) { items.push({ kind:'service', name: svcM[1], depth: stack.length }); stack.push('service'); }
    else if (rpcM && stack[stack.length-1]==='service') {
      items.push({ kind:'rpc', name: rpcM[1], req: rpcM[2].trim(), res: rpcM[3].trim(), depth: stack.length });
    } else if (fieldM && stack.length > 0 && stack[stack.length-1]==='message') {
      const isRep = t.startsWith('repeated');
      items.push({ kind:'field', type: (isRep?'repeated ':'')+fieldM[1], name: fieldM[2], num: fieldM[3], depth: stack.length });
    }
    if (t === '}' || t === '};') stack.pop();
  }
  return items;
}

// ── Tests ────────────────────────────────────────────────────────────────────

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch(e) { console.error(`FAIL [${name}]: ${e.message}`); process.exit(1); }
}

// formatProto tests
test('format: simple message indented', () => {
  const src = 'message Foo {\nstring name = 1;\n}';
  const out = formatProto(src);
  assert.ok(out.includes('  string name = 1;'), `got: ${out}`);
});
test('format: top-level statement not indented', () => {
  const out = formatProto('syntax = "proto3";');
  assert.equal(out, 'syntax = "proto3";');
});
test('format: nested message', () => {
  const src = 'message A {\nmessage B {\nstring x = 1;\n}\n}';
  const out = formatProto(src);
  assert.ok(out.includes('    string x = 1;'));
});
test('format: enum indented', () => {
  const src = 'enum Role {\nROLE_UNSPECIFIED = 0;\nROLE_ADMIN = 1;\n}';
  const out = formatProto(src);
  assert.ok(out.includes('  ROLE_UNSPECIFIED = 0;'));
  assert.ok(out.includes('  ROLE_ADMIN = 1;'));
});
test('format: closing brace at correct indent', () => {
  const src = 'message X {\nstring a = 1;\n}';
  const out = formatProto(src);
  const lines = out.split('\n');
  assert.ok(lines.some(l => l === '}'), `lines: ${lines}`);
});
test('format: package line not indented', () => {
  const src = 'package foo.bar;';
  assert.equal(formatProto(src), 'package foo.bar;');
});
test('format: multiple blank lines collapsed', () => {
  const out = formatProto('a = 1;\n\n\n\nb = 2;');
  assert.ok(!out.includes('\n\n\n'));
});
test('format: service with rpc', () => {
  const src = 'service Svc {\nrpc Get(Req) returns (Res);\n}';
  const out = formatProto(src);
  assert.ok(out.includes('  rpc Get(Req) returns (Res);'));
});
test('format: repeated field', () => {
  const src = 'message M {\nrepeated string tags = 1;\n}';
  const out = formatProto(src);
  assert.ok(out.includes('  repeated string tags = 1;'));
});
test('format: empty message', () => {
  const src = 'message Empty {\n}';
  const out = formatProto(src);
  assert.ok(out.includes('message Empty {'));
  assert.ok(out.includes('}'));
});
test('format: option line not indented', () => {
  const out = formatProto('option go_package = "foo";');
  assert.equal(out, 'option go_package = "foo";');
});
test('format: import line preserved', () => {
  const out = formatProto('import "google/protobuf/timestamp.proto";');
  assert.equal(out, 'import "google/protobuf/timestamp.proto";');
});
test('format: comment preserved', () => {
  const src = '// This is a comment\nmessage M {\n}';
  const out = formatProto(src);
  assert.ok(out.includes('// This is a comment'));
});
test('format: multiple messages', () => {
  const src = 'message A {\nstring x = 1;\n}\nmessage B {\nint32 y = 1;\n}';
  const out = formatProto(src);
  assert.ok(out.includes('message A {'));
  assert.ok(out.includes('message B {'));
});
test('format: oneof indented', () => {
  const src = 'message M {\noneof choice {\nstring a = 1;\nint32 b = 2;\n}\n}';
  const out = formatProto(src);
  assert.ok(out.includes('  oneof choice {'));
  assert.ok(out.includes('    string a = 1;'));
});

// validate tests
test('validate: warns on missing syntax', () => {
  const issues = validate('message M {}');
  assert.ok(issues.some(i => i.type === 'warn' && i.msg.includes('syntax')));
});
test('validate: no warn when proto3 declared', () => {
  const issues = validate('syntax = "proto3";\nmessage M { string x = 1; }');
  assert.ok(!issues.some(i => i.msg.includes('syntax')));
});
test('validate: no warn when proto2 declared', () => {
  const issues = validate('syntax = "proto2";\nmessage M { required string x = 1; }');
  assert.ok(!issues.some(i => i.msg.includes('syntax')));
});
test('validate: detects zero field number', () => {
  const src = 'syntax = "proto3";\nmessage M {\nstring name = 0;\n}';
  const issues = validate(src);
  assert.ok(issues.some(i => i.type === 'error' && i.msg.includes('positive')));
});
test('validate: warns on reserved range 19000-19999', () => {
  const src = 'syntax = "proto3";\nmessage M {\nstring x = 19000;\n}';
  const issues = validate(src);
  assert.ok(issues.some(i => i.type === 'warn' && i.msg.includes('Reserved')));
});
test('validate: detects duplicate field number', () => {
  const src = 'syntax = "proto3";\nmessage M {\nstring a = 1;\nstring b = 1;\n}';
  const issues = validate(src);
  assert.ok(issues.some(i => i.type === 'error' && i.msg.includes('Duplicate')));
});
test('validate: no duplicate for different messages', () => {
  const src = 'syntax = "proto3";\nmessage A { string x = 1; }\nmessage B { string y = 1; }';
  const issues = validate(src);
  assert.ok(!issues.some(i => i.msg.includes('Duplicate')));
});
test('validate: warns camelCase field name', () => {
  const src = 'syntax = "proto3";\nmessage M {\nstring firstName = 1;\n}';
  const issues = validate(src);
  assert.ok(issues.some(i => i.type === 'warn' && i.msg.includes('snake_case')));
});
test('validate: ok for snake_case field name', () => {
  const src = 'syntax = "proto3";\nmessage M {\nstring first_name = 1;\n}';
  const issues = validate(src);
  assert.ok(!issues.some(i => i.msg.includes('snake_case')));
});
test('validate: ok status when no errors', () => {
  const src = 'syntax = "proto3";\nmessage M {\nstring name = 1;\n}';
  const issues = validate(src);
  assert.ok(issues.some(i => i.type === 'ok'));
});
test('validate: import without semicolon warns', () => {
  const src = 'syntax = "proto3";\nimport "foo"';
  const issues = validate(src);
  assert.ok(issues.some(i => i.msg.includes('semicolon')));
});
test('validate: import with semicolon ok', () => {
  const src = 'syntax = "proto3";\nimport "foo";';
  const issues = validate(src);
  assert.ok(!issues.some(i => i.msg.includes('semicolon')));
});
test('validate: field number 1 is valid', () => {
  const src = 'syntax = "proto3";\nmessage M { string x = 1; }';
  const issues = validate(src);
  assert.ok(!issues.some(i => i.type === 'error' && i.msg.includes('positive')));
});
test('validate: field number 18999 ok (not reserved)', () => {
  const src = 'syntax = "proto3";\nmessage M { string x = 18999; }';
  const issues = validate(src);
  assert.ok(!issues.some(i => i.msg.includes('Reserved')));
});
test('validate: field number 20000 ok (above reserved)', () => {
  const src = 'syntax = "proto3";\nmessage M { string x = 20000; }';
  const issues = validate(src);
  assert.ok(!issues.some(i => i.msg.includes('Reserved')));
});
test('validate: comments ignored in field detection', () => {
  const src = 'syntax = "proto3";\nmessage M {\n// string name = 1;\nstring name = 1;\n}';
  const issues = validate(src);
  assert.ok(!issues.some(i => i.msg.includes('Duplicate')));
});

// extractStructure tests
test('structure: detects message', () => {
  const src = 'message User {\nstring name = 1;\n}';
  const s = extractStructure(src);
  assert.ok(s.some(i => i.kind === 'message' && i.name === 'User'));
});
test('structure: detects enum', () => {
  const src = 'enum Status {\nSTATUS_UNKNOWN = 0;\n}';
  const s = extractStructure(src);
  assert.ok(s.some(i => i.kind === 'enum' && i.name === 'Status'));
});
test('structure: detects service', () => {
  const src = 'service MyService {\nrpc Get(Req) returns (Res);\n}';
  const s = extractStructure(src);
  assert.ok(s.some(i => i.kind === 'service' && i.name === 'MyService'));
});
test('structure: detects rpc inside service', () => {
  const src = 'service Svc {\nrpc GetUser(GetUserRequest) returns (GetUserResponse);\n}';
  const s = extractStructure(src);
  assert.ok(s.some(i => i.kind === 'rpc' && i.name === 'GetUser'));
});
test('structure: rpc has req and res', () => {
  const src = 'service Svc {\nrpc Foo(FooReq) returns (FooRes);\n}';
  const s = extractStructure(src);
  const rpc = s.find(i => i.kind === 'rpc');
  assert.equal(rpc.req, 'FooReq');
  assert.equal(rpc.res, 'FooRes');
});
test('structure: detects field in message', () => {
  const src = 'message M {\nstring email = 2;\n}';
  const s = extractStructure(src);
  assert.ok(s.some(i => i.kind === 'field' && i.name === 'email' && i.num === '2'));
});
test('structure: repeated field marked', () => {
  const src = 'message M {\nrepeated string tags = 5;\n}';
  const s = extractStructure(src);
  const field = s.find(i => i.kind === 'field');
  assert.ok(field.type.startsWith('repeated'));
});
test('structure: message depth is 0', () => {
  const s = extractStructure('message M {\n}');
  const msg = s.find(i => i.kind === 'message');
  assert.equal(msg.depth, 0);
});
test('structure: field depth is 1', () => {
  const src = 'message M {\nstring x = 1;\n}';
  const s = extractStructure(src);
  const field = s.find(i => i.kind === 'field');
  assert.equal(field.depth, 1);
});
test('structure: multiple messages counted', () => {
  const src = 'message A {}\nmessage B {}\nmessage C {}';
  const s = extractStructure(src);
  assert.equal(s.filter(i => i.kind === 'message').length, 3);
});
test('structure: empty input returns empty', () => {
  assert.equal(extractStructure('').length, 0);
});
test('structure: comments not treated as messages', () => {
  const src = '// message Fake {\n// }';
  const s = extractStructure(src);
  assert.equal(s.filter(i => i.kind === 'message').length, 0);
});
test('structure: nested message has depth 1', () => {
  const src = 'message Outer {\nmessage Inner {\n}\n}';
  const s = extractStructure(src);
  const inner = s.find(i => i.name === 'Inner');
  assert.equal(inner.depth, 1);
});

// PROTO_TYPES set tests
test('types: string is proto type', () => assert.ok(PROTO_TYPES.has('string')));
test('types: int32 is proto type', () => assert.ok(PROTO_TYPES.has('int32')));
test('types: int64 is proto type', () => assert.ok(PROTO_TYPES.has('int64')));
test('types: bool is proto type', () => assert.ok(PROTO_TYPES.has('bool')));
test('types: bytes is proto type', () => assert.ok(PROTO_TYPES.has('bytes')));
test('types: double is proto type', () => assert.ok(PROTO_TYPES.has('double')));
test('types: float is proto type', () => assert.ok(PROTO_TYPES.has('float')));
test('types: uint32 is proto type', () => assert.ok(PROTO_TYPES.has('uint32')));
test('types: uint64 is proto type', () => assert.ok(PROTO_TYPES.has('uint64')));
test('types: fixed32 is proto type', () => assert.ok(PROTO_TYPES.has('fixed32')));
test('types: fixed64 is proto type', () => assert.ok(PROTO_TYPES.has('fixed64')));
test('types: sint32 is proto type', () => assert.ok(PROTO_TYPES.has('sint32')));
test('types: sfixed32 is proto type', () => assert.ok(PROTO_TYPES.has('sfixed32')));
test('types: sfixed64 is proto type', () => assert.ok(PROTO_TYPES.has('sfixed64')));
test('types: sint64 is proto type', () => assert.ok(PROTO_TYPES.has('sint64')));
test('types: varchar is NOT proto type', () => assert.ok(!PROTO_TYPES.has('varchar')));
test('types: integer is NOT proto type', () => assert.ok(!PROTO_TYPES.has('integer')));

// PROTO_KEYWORDS set tests
test('keywords: message is keyword', () => assert.ok(PROTO_KEYWORDS.has('message')));
test('keywords: enum is keyword', () => assert.ok(PROTO_KEYWORDS.has('enum')));
test('keywords: service is keyword', () => assert.ok(PROTO_KEYWORDS.has('service')));
test('keywords: rpc is keyword', () => assert.ok(PROTO_KEYWORDS.has('rpc')));
test('keywords: syntax is keyword', () => assert.ok(PROTO_KEYWORDS.has('syntax')));
test('keywords: import is keyword', () => assert.ok(PROTO_KEYWORDS.has('import')));
test('keywords: package is keyword', () => assert.ok(PROTO_KEYWORDS.has('package')));
test('keywords: repeated is keyword', () => assert.ok(PROTO_KEYWORDS.has('repeated')));
test('keywords: optional is keyword', () => assert.ok(PROTO_KEYWORDS.has('optional')));
test('keywords: required is keyword', () => assert.ok(PROTO_KEYWORDS.has('required')));
test('keywords: oneof is keyword', () => assert.ok(PROTO_KEYWORDS.has('oneof')));
test('keywords: map is keyword', () => assert.ok(PROTO_KEYWORDS.has('map')));
test('keywords: option is keyword', () => assert.ok(PROTO_KEYWORDS.has('option')));
test('keywords: reserved is keyword', () => assert.ok(PROTO_KEYWORDS.has('reserved')));
test('keywords: returns is keyword', () => assert.ok(PROTO_KEYWORDS.has('returns')));
test('keywords: foo is NOT keyword', () => assert.ok(!PROTO_KEYWORDS.has('foo')));

// Additional edge case tests
test('format: deeply nested 3 levels', () => {
  const src = 'message A {\nmessage B {\nmessage C {\nstring x = 1;\n}\n}\n}';
  const out = formatProto(src);
  assert.ok(out.includes('      string x = 1;'));
});
test('format: syntax line preserved exactly', () => {
  const out = formatProto('syntax = "proto3";');
  assert.equal(out, 'syntax = "proto3";');
});
test('validate: single field no error', () => {
  const src = 'syntax = "proto3";\nmessage M {\nstring x = 1;\n}';
  const issues = validate(src);
  assert.ok(issues.some(i => i.type === 'ok'));
});
test('validate: multiple fields unique numbers ok', () => {
  const src = 'syntax = "proto3";\nmessage M {\nstring a = 1;\nint32 b = 2;\nbool c = 3;\n}';
  const issues = validate(src);
  assert.ok(!issues.some(i => i.type === 'error'));
});
test('validate: proto3 string match exact', () => {
  const src = 'syntax = "proto3";';
  const issues = validate(src);
  assert.ok(!issues.some(i => i.msg.includes('syntax')));
});
test('format: trim trailing whitespace lines', () => {
  const out = formatProto('   syntax = "proto3";   ');
  assert.equal(out, 'syntax = "proto3";');
});
test('structure: no rpc outside service', () => {
  const src = 'rpc Foo(Req) returns (Res);';
  const s = extractStructure(src);
  assert.equal(s.filter(i => i.kind === 'rpc').length, 0);
});
test('validate: field number 19999 is reserved', () => {
  const src = 'syntax = "proto3";\nmessage M {\nstring x = 19999;\n}';
  const issues = validate(src);
  assert.ok(issues.some(i => i.msg.includes('Reserved')));
});
test('validate: field number 19500 is reserved', () => {
  const src = 'syntax = "proto3";\nmessage M {\nstring x = 19500;\n}';
  const issues = validate(src);
  assert.ok(issues.some(i => i.msg.includes('Reserved')));
});
test('structure: field num stored as string', () => {
  const src = 'message M {\nstring name = 42;\n}';
  const s = extractStructure(src);
  const f = s.find(i => i.kind === 'field');
  assert.equal(f.num, '42');
});
test('format: handles windows line endings', () => {
  const src = 'message M {\r\nstring x = 1;\r\n}';
  const out = formatProto(src);
  assert.ok(out.includes('string x = 1;'));
});
test('validate: empty string has no fatal error', () => {
  const issues = validate('');
  assert.ok(Array.isArray(issues));
});
test('structure: service with 2 rpcs', () => {
  const src = 'service S {\nrpc A(Req) returns (Res);\nrpc B(Req2) returns (Res2);\n}';
  const s = extractStructure(src);
  assert.equal(s.filter(i => i.kind === 'rpc').length, 2);
});

console.log(`\nAll ${passed} tests passed.`);
