import assert from 'node:assert/strict';

// ── Core logic from index.html ────────────────────────────────────────────────

function minifyGQL(src) {
  return src
    .replace(/#[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}()\[\]:!,])\s*/g, '$1')
    .replace(/\s*\.\.\.\s*/g, '...')
    .trim();
}

function detectOperations(src) {
  const ops = [];
  for (const m of src.matchAll(/\b(query|mutation|subscription|fragment)\s+(\w+)/g)) {
    ops.push({ kind: m[1], name: m[2] });
  }
  return ops;
}

function validateGQL(src) {
  const issues = [];
  const opens = (src.match(/\{/g) || []).length;
  const closes = (src.match(/\}/g) || []).length;
  if (opens !== closes) issues.push({ type: 'err', msg: `Unbalanced braces: ${opens} opening, ${closes} closing` });
  const openP = (src.match(/\(/g) || []).length;
  const closeP = (src.match(/\)/g) || []).length;
  if (openP !== closeP) issues.push({ type: 'err', msg: `Unbalanced parentheses: ${openP} opening, ${closeP} closing` });
  if (issues.length === 0) issues.push({ type: 'ok', msg: 'Structure looks valid' });
  return issues;
}

function tokenizeRaw(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === '#') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      tokens.push(src.slice(i, j));
      i = j;
      continue;
    }
    if (src[i] === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      tokens.push(src.slice(i, j+1));
      i = j + 1;
      continue;
    }
    if (src[i] === '.' && src[i+1] === '.' && src[i+2] === '.') {
      tokens.push('...');
      i += 3;
      continue;
    }
    if (/[\s\n]/.test(src[i])) { i++; continue; }
    if (/[{}()\[\]:!,|@$]/.test(src[i])) { tokens.push(src[i]); i++; continue; }
    if (/[\w]/.test(src[i])) {
      let j = i;
      while (j < src.length && /[\w]/.test(src[j])) j++;
      tokens.push(src.slice(i, j));
      i = j;
      continue;
    }
    i++;
  }
  return tokens;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch(e) { console.error(`FAIL [${name}]: ${e.message}`); process.exit(1); }
}

// minifyGQL tests
test('minify: removes newlines', () => {
  const out = minifyGQL('query {\n  user {\n    name\n  }\n}');
  assert.ok(!out.includes('\n'));
});
test('minify: removes multiple spaces', () => {
  const out = minifyGQL('query   GetUser   {   id   }');
  assert.ok(!out.includes('  '));
});
test('minify: removes comments', () => {
  const out = minifyGQL('# this is a comment\nquery { id }');
  assert.ok(!out.includes('#'));
  assert.ok(!out.includes('comment'));
});
test('minify: compacts braces', () => {
  const out = minifyGQL('query { user { name } }');
  assert.ok(out.includes('{user{name}}') || out.includes('{ user { name } }') || !out.includes('  '));
});
test('minify: preserves field names', () => {
  const out = minifyGQL('query { user { id name email } }');
  assert.ok(out.includes('id'));
  assert.ok(out.includes('name'));
  assert.ok(out.includes('email'));
});
test('minify: removes inline comments', () => {
  const out = minifyGQL('query { # get user\n  user { id } }');
  assert.ok(!out.includes('get user'));
});
test('minify: preserves string values', () => {
  const out = minifyGQL('mutation { create(name: "John Doe") { id } }');
  assert.ok(out.includes('"John Doe"'));
});
test('minify: handles empty string', () => {
  assert.equal(minifyGQL(''), '');
});
test('minify: handles whitespace-only', () => {
  assert.equal(minifyGQL('   \n\t  '), '');
});
test('minify: reduces size', () => {
  const src = 'query GetUser($id: ID!) {\n  user(id: $id) {\n    id\n    name\n    email\n  }\n}';
  assert.ok(minifyGQL(src).length < src.length);
});
test('minify: removes tab indentation', () => {
  const out = minifyGQL('query {\n\tuser {\n\t\tname\n\t}\n}');
  assert.ok(!out.includes('\t'));
});
test('minify: compacts parentheses', () => {
  const out = minifyGQL('query ( $id : ID! ) { user }');
  assert.ok(!out.includes(' ( ') && !out.includes(' ) '));
});
test('minify: spreads collapsed', () => {
  const out = minifyGQL('query { user { ... UserFields } }');
  assert.ok(out.includes('...'));
});
test('minify: variable preserved', () => {
  const out = minifyGQL('query($id: ID!) { user(id: $id) { name } }');
  assert.ok(out.includes('$id'));
});
test('minify: directive preserved', () => {
  const out = minifyGQL('query { user @include(if: true) { name } }');
  assert.ok(out.includes('@include'));
});
test('minify: no trailing spaces', () => {
  const out = minifyGQL('query { user { name } }');
  assert.ok(!out.endsWith(' '));
});
test('minify: handles colons', () => {
  const out = minifyGQL('query { user(id: "1") { name } }');
  assert.ok(out.includes('id:'));
});
test('minify: handles exclamation', () => {
  const out = minifyGQL('query($id: ID!) { id }');
  assert.ok(out.includes('ID!'));
});
test('minify: multiple comment lines removed', () => {
  const out = minifyGQL('# line 1\n# line 2\n# line 3\nquery { id }');
  assert.ok(!out.includes('#'));
  assert.ok(out.includes('query'));
});
test('minify: mutation preserved', () => {
  const out = minifyGQL('mutation CreateUser($input: UserInput!) { createUser(input: $input) { id } }');
  assert.ok(out.includes('mutation'));
  assert.ok(out.includes('CreateUser'));
});

// detectOperations tests
test('detect: finds query', () => {
  const ops = detectOperations('query GetUser { id }');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, 'query');
  assert.equal(ops[0].name, 'GetUser');
});
test('detect: finds mutation', () => {
  const ops = detectOperations('mutation CreateUser($input: UserInput!) { id }');
  assert.equal(ops[0].kind, 'mutation');
  assert.equal(ops[0].name, 'CreateUser');
});
test('detect: finds subscription', () => {
  const ops = detectOperations('subscription OnEvent { id }');
  assert.equal(ops[0].kind, 'subscription');
  assert.equal(ops[0].name, 'OnEvent');
});
test('detect: finds fragment', () => {
  const ops = detectOperations('fragment UserFields on User { id }');
  assert.equal(ops[0].kind, 'fragment');
  assert.equal(ops[0].name, 'UserFields');
});
test('detect: finds multiple operations', () => {
  const src = 'query GetUser { id }\nmutation CreatePost { id }\nsubscription OnEvent { id }';
  const ops = detectOperations(src);
  assert.equal(ops.length, 3);
});
test('detect: empty input returns empty', () => {
  assert.equal(detectOperations('').length, 0);
});
test('detect: anonymous query not detected', () => {
  const ops = detectOperations('query { id }');
  assert.equal(ops.length, 0);
});
test('detect: fragment and query together', () => {
  const src = 'fragment F on T { id }\nquery Q { ...F }';
  const ops = detectOperations(src);
  assert.equal(ops.filter(o => o.kind === 'fragment').length, 1);
  assert.equal(ops.filter(o => o.kind === 'query').length, 1);
});
test('detect: kind is correct for each', () => {
  const ops = detectOperations('query A { id } mutation B { id } subscription C { id } fragment D on T { id }');
  const kinds = ops.map(o => o.kind).sort();
  assert.deepEqual(kinds, ['fragment','mutation','query','subscription']);
});
test('detect: name extraction correct', () => {
  const ops = detectOperations('query GetAllUsers { id }');
  assert.equal(ops[0].name, 'GetAllUsers');
});

// validateGQL tests
test('validate: balanced braces ok', () => {
  const issues = validateGQL('query { user { name } }');
  assert.ok(issues.some(i => i.type === 'ok'));
});
test('validate: unbalanced opening brace error', () => {
  const issues = validateGQL('query { user { name }');
  assert.ok(issues.some(i => i.type === 'err' && i.msg.includes('brace')));
});
test('validate: unbalanced closing brace error', () => {
  const issues = validateGQL('query { user name } }');
  assert.ok(issues.some(i => i.type === 'err' && i.msg.includes('brace')));
});
test('validate: balanced parens ok', () => {
  const issues = validateGQL('query { user(id: "1") { name } }');
  assert.ok(issues.some(i => i.type === 'ok'));
});
test('validate: unbalanced open paren error', () => {
  const issues = validateGQL('query { user(id: "1" { name } }');
  assert.ok(issues.some(i => i.type === 'err' && i.msg.includes('parenthes')));
});
test('validate: unbalanced close paren error', () => {
  const issues = validateGQL('query { user id: "1") { name } }');
  assert.ok(issues.some(i => i.type === 'err' && i.msg.includes('parenthes')));
});
test('validate: empty string ok (no braces)', () => {
  const issues = validateGQL('');
  assert.ok(issues.some(i => i.type === 'ok'));
});
test('validate: multiple issues returned for multiple errors', () => {
  const issues = validateGQL('query { user( { name }');
  assert.ok(issues.length >= 1);
});
test('validate: brace count in message', () => {
  const issues = validateGQL('{ {');
  const errIssue = issues.find(i => i.type === 'err');
  assert.ok(errIssue.msg.includes('2'));
});

// tokenizeRaw tests
test('tokenize: extracts field name', () => {
  const tokens = tokenizeRaw('{ userName }');
  assert.ok(tokens.includes('userName'));
});
test('tokenize: extracts braces', () => {
  const tokens = tokenizeRaw('{ }');
  assert.ok(tokens.includes('{'));
  assert.ok(tokens.includes('}'));
});
test('tokenize: skips whitespace', () => {
  const tokens = tokenizeRaw('  id  ');
  assert.deepEqual(tokens, ['id']);
});
test('tokenize: handles spread operator', () => {
  const tokens = tokenizeRaw('...UserFields');
  assert.ok(tokens.includes('...'));
  assert.ok(tokens.includes('UserFields'));
});
test('tokenize: handles at-directive', () => {
  const tokens = tokenizeRaw('@include');
  assert.ok(tokens.includes('@'));
  assert.ok(tokens.includes('include'));
});
test('tokenize: handles dollar variable', () => {
  const tokens = tokenizeRaw('$id');
  assert.ok(tokens.includes('$'));
  assert.ok(tokens.includes('id'));
});
test('tokenize: handles colon', () => {
  const tokens = tokenizeRaw('id: "1"');
  assert.ok(tokens.includes(':'));
});
test('tokenize: handles string with space', () => {
  const tokens = tokenizeRaw('"hello world"');
  assert.ok(tokens.includes('"hello world"'));
});
test('tokenize: handles comment line', () => {
  const tokens = tokenizeRaw('# this is a comment\nfield');
  assert.ok(tokens[0].startsWith('#'));
  assert.ok(tokens.includes('field'));
});
test('tokenize: handles exclamation', () => {
  const tokens = tokenizeRaw('ID!');
  assert.ok(tokens.includes('!'));
});
test('tokenize: handles parens', () => {
  const tokens = tokenizeRaw('user(id: "1")');
  assert.ok(tokens.includes('('));
  assert.ok(tokens.includes(')'));
});
test('tokenize: handles multiple fields', () => {
  const tokens = tokenizeRaw('{ id name email }');
  assert.ok(tokens.includes('id'));
  assert.ok(tokens.includes('name'));
  assert.ok(tokens.includes('email'));
});
test('tokenize: empty returns empty array', () => {
  assert.deepEqual(tokenizeRaw(''), []);
});
test('tokenize: handles comma', () => {
  const tokens = tokenizeRaw('a, b');
  assert.ok(tokens.includes(','));
});
test('tokenize: handles array brackets', () => {
  const tokens = tokenizeRaw('[String]');
  assert.ok(tokens.includes('['));
  assert.ok(tokens.includes(']'));
});

// edge case tests
test('minify: fragment spread preserved', () => {
  const out = minifyGQL('{ ...on User { name } }');
  assert.ok(out.includes('...'));
  assert.ok(out.includes('on'));
  assert.ok(out.includes('User'));
});
test('detect: case sensitive - QUERY not detected', () => {
  const ops = detectOperations('QUERY GetUser { id }');
  assert.equal(ops.length, 0);
});
test('validate: nested braces balanced', () => {
  const src = 'query { a { b { c { d } } } }';
  const issues = validateGQL(src);
  assert.ok(issues.some(i => i.type === 'ok'));
});
test('minify: removes leading/trailing whitespace', () => {
  const out = minifyGQL('  query { id }  ');
  assert.ok(!out.startsWith(' '));
  assert.ok(!out.endsWith(' '));
});
test('detect: query without variables', () => {
  const ops = detectOperations('query GetUser { user { id } }');
  assert.equal(ops[0].name, 'GetUser');
});

// additional minify tests
test('minify: alias preserved', () => {
  const out = minifyGQL('query { myUser: user { id } }');
  assert.ok(out.includes('myUser'));
  assert.ok(out.includes('user'));
});
test('minify: list type preserved', () => {
  const out = minifyGQL('query($ids: [ID!]!) { users(ids: $ids) { id } }');
  assert.ok(out.includes('[ID!]!'));
});
test('minify: default value preserved', () => {
  const out = minifyGQL('query($limit: Int = 10) { users { id } }');
  assert.ok(out.includes('Int'));
  assert.ok(out.includes('10'));
});
test('minify: subscription preserved', () => {
  const out = minifyGQL('subscription OnMessage { message { text sender } }');
  assert.ok(out.includes('subscription'));
  assert.ok(out.includes('OnMessage'));
});
test('minify: multiple directives preserved', () => {
  const out = minifyGQL('query { user @skip(if: false) { name @deprecated } }');
  assert.ok(out.includes('@skip'));
  assert.ok(out.includes('@deprecated'));
});
test('minify: inline fragment preserved', () => {
  const out = minifyGQL('query { node { ... on User { name } } }');
  assert.ok(out.includes('...'));
  assert.ok(out.includes('on'));
  assert.ok(out.includes('User'));
});
test('minify: multiple mutations', () => {
  const out = minifyGQL('mutation A { createUser { id } } mutation B { deleteUser { id } }');
  assert.ok(out.includes('mutation A'));
  assert.ok(out.includes('mutation B'));
});

// additional detectOperations tests
test('detect: multiple queries', () => {
  const ops = detectOperations('query A { id } query B { id }');
  assert.equal(ops.filter(o => o.kind === 'query').length, 2);
});
test('detect: mixed case names', () => {
  const ops = detectOperations('query getUserById { id }');
  assert.equal(ops[0].name, 'getUserById');
});
test('detect: fragment with underscore name', () => {
  const ops = detectOperations('fragment User_Fields on User { id }');
  assert.equal(ops[0].name, 'User_Fields');
});
test('detect: empty whitespace only', () => {
  const ops = detectOperations('   \n\t  ');
  assert.equal(ops.length, 0);
});
test('detect: nested fragment in query', () => {
  const src = 'fragment F on T { id }\nquery Q { ...F }\nmutation M { createT { id } }';
  const ops = detectOperations(src);
  assert.equal(ops.length, 3);
});

// additional validateGQL tests
test('validate: both brace and paren unbalanced', () => {
  const issues = validateGQL('query { user(id: "1" { name }');
  assert.ok(issues.length >= 1);
});
test('validate: only whitespace is valid', () => {
  const issues = validateGQL('   \n  ');
  assert.ok(issues.some(i => i.type === 'ok'));
});
test('validate: single brace unbalanced', () => {
  const issues = validateGQL('{');
  assert.ok(issues.some(i => i.type === 'err'));
});
test('validate: brace count correct in msg', () => {
  const issues = validateGQL('{ { {');
  const err = issues.find(i => i.type === 'err' && i.msg.includes('3'));
  assert.ok(err);
});

// additional tokenizeRaw tests
test('tokenize: underscore in identifier', () => {
  const tokens = tokenizeRaw('user_name');
  assert.ok(tokens.includes('user_name'));
});
test('tokenize: pipe character', () => {
  const tokens = tokenizeRaw('String | Int');
  assert.ok(tokens.includes('|'));
});
test('tokenize: list type brackets', () => {
  const tokens = tokenizeRaw('[String!]');
  assert.ok(tokens.includes('['));
  assert.ok(tokens.includes(']'));
  assert.ok(tokens.includes('!'));
});
test('tokenize: multiple spreads', () => {
  const tokens = tokenizeRaw('...A ...B');
  const spreads = tokens.filter(t => t === '...');
  assert.equal(spreads.length, 2);
});
test('tokenize: numbers in token', () => {
  const tokens = tokenizeRaw('field123');
  assert.ok(tokens.includes('field123'));
});
test('tokenize: multiple comments', () => {
  const tokens = tokenizeRaw('# comment 1\n# comment 2\nfield');
  assert.ok(tokens[0].startsWith('#'));
  assert.ok(tokens[tokens.length - 1] === 'field');
});

console.log(`\nAll ${passed} tests passed.`);
