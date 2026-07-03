import assert from 'node:assert/strict';

// ── Core logic (copied from index.html) ───────────────────────────────────────

function parseEmailHeaders(raw) {
  const headers = [];
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)/);
    if (m) {
      let value = m[2];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        i++;
        value += ' ' + lines[i].trim();
      }
      headers.push({ name: m[1].toLowerCase(), rawName: m[1], value: value.trim() });
    }
    i++;
  }
  return headers;
}

function getHeader(headers, name) {
  const h = headers.find(h => h.name === name.toLowerCase());
  return h ? h.value : null;
}

function getAllHeaders(headers, name) {
  return headers.filter(h => h.name === name.toLowerCase()).map(h => h.value);
}

function extractEmail(value) {
  if (!value) return null;
  const m = value.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  const plain = value.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/);
  return plain ? plain[0] : null;
}

function extractDomain(email) {
  if (!email) return null;
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : null;
}

function parseReceivedHeader(value) {
  const fromMatch = value.match(/from\s+([^\s(;]+)/i);
  const byMatch = value.match(/by\s+([^\s(;]+)/i);
  const dateMatch = value.match(/;\s*(.+)$/);
  const ipMatch = value.match(/\[(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]/);
  return {
    from: fromMatch ? fromMatch[1] : null,
    by: byMatch ? byMatch[1] : null,
    date: dateMatch ? dateMatch[1].trim() : null,
    ip: ipMatch ? ipMatch[1] : null,
  };
}

function parseAuthResults(value) {
  if (!value) return { spf: null, dkim: null, dmarc: null };
  const spfMatch = value.match(/spf=([a-zA-Z]+)/i);
  const dkimMatch = value.match(/dkim=([a-zA-Z]+)/i);
  const dmarcMatch = value.match(/dmarc=([a-zA-Z]+)/i);
  return {
    spf: spfMatch ? spfMatch[1].toLowerCase() : null,
    dkim: dkimMatch ? dkimMatch[1].toLowerCase() : null,
    dmarc: dmarcMatch ? dmarcMatch[1].toLowerCase() : null,
  };
}

function getSpfResult(headers) {
  const authResults = getAllHeaders(headers, 'authentication-results');
  for (const ar of authResults) {
    const m = ar.match(/spf=([a-zA-Z]+)/i);
    if (m) return m[1].toLowerCase();
  }
  const received = getAllHeaders(headers, 'received-spf');
  if (received.length) {
    const m = received[0].match(/^([a-zA-Z]+)/);
    return m ? m[1].toLowerCase() : null;
  }
  return null;
}

function getDkimResult(headers) {
  const authResults = getAllHeaders(headers, 'authentication-results');
  for (const ar of authResults) {
    const m = ar.match(/dkim=([a-zA-Z]+)/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function getDmarcResult(headers) {
  const authResults = getAllHeaders(headers, 'authentication-results');
  for (const ar of authResults) {
    const m = ar.match(/dmarc=([a-zA-Z]+)/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function isSpam(headers) {
  const spamScore = getHeader(headers, 'x-spam-score');
  const spamFlag = getHeader(headers, 'x-spam-flag');
  if (spamFlag && spamFlag.toUpperCase() === 'YES') return true;
  if (spamScore && parseFloat(spamScore) > 5) return true;
  return false;
}

function getRoutingHops(headers) {
  return getAllHeaders(headers, 'received').map((v, idx) => ({
    num: idx + 1,
    ...parseReceivedHeader(v),
  }));
}

function analyzeEmailHeaders(raw) {
  const headers = parseEmailHeaders(raw);
  const from = getHeader(headers, 'from');
  const to = getHeader(headers, 'to');
  const subject = getHeader(headers, 'subject');
  const date = getHeader(headers, 'date');
  const messageId = getHeader(headers, 'message-id');
  const replyTo = getHeader(headers, 'reply-to');
  const returnPath = getHeader(headers, 'return-path');
  const fromEmail = extractEmail(from);
  const replyToEmail = extractEmail(replyTo);
  const returnPathEmail = extractEmail(returnPath);
  const fromDomain = extractDomain(fromEmail);
  const replyToDomain = extractDomain(replyToEmail);
  const returnPathDomain = extractDomain(returnPathEmail);
  const spf = getSpfResult(headers);
  const dkim = getDkimResult(headers);
  const dmarc = getDmarcResult(headers);
  const warnings = [];
  if (replyToEmail && fromDomain && replyToDomain && replyToDomain !== fromDomain) {
    warnings.push(`Reply-To domain (${replyToDomain}) differs from From domain (${fromDomain}) — possible phishing`);
  }
  if (returnPathDomain && fromDomain && returnPathDomain !== fromDomain) {
    warnings.push(`Return-Path domain (${returnPathDomain}) differs from From domain (${fromDomain})`);
  }
  if (spf === 'fail' || spf === 'softfail') {
    warnings.push(`SPF check ${spf} — sender IP is not authorized`);
  }
  if (dkim === 'fail') {
    warnings.push('DKIM signature verification failed');
  }
  if (dmarc === 'fail') {
    warnings.push('DMARC policy check failed');
  }
  if (isSpam(headers)) {
    warnings.push('Email flagged as spam by spam filter');
  }
  const hops = getRoutingHops(headers);
  return { headers, summary: { from, to, subject, date, messageId, replyTo, returnPath }, auth: { spf, dkim, dmarc }, warnings, hops, fromEmail, fromDomain };
}

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch(e) { console.error(`FAIL [${name}]: ${e.message}`); process.exit(1); }
}

// ── parseEmailHeaders ─────────────────────────────────────────────────────────

test('parse: single header', () => {
  const h = parseEmailHeaders('From: alice@example.com\n');
  assert.equal(h.length, 1);
  assert.equal(h[0].name, 'from');
  assert.equal(h[0].value, 'alice@example.com');
});
test('parse: preserves rawName casing', () => {
  const h = parseEmailHeaders('Message-ID: <abc@def>\n');
  assert.equal(h[0].rawName, 'Message-ID');
});
test('parse: lowercases name', () => {
  const h = parseEmailHeaders('Subject: Hello\n');
  assert.equal(h[0].name, 'subject');
});
test('parse: multiple headers', () => {
  const raw = 'From: a@b.com\nTo: c@d.com\nSubject: Hi\n';
  const h = parseEmailHeaders(raw);
  assert.equal(h.length, 3);
});
test('parse: skips blank lines', () => {
  const raw = 'From: a@b.com\n\nTo: c@d.com\n';
  const h = parseEmailHeaders(raw);
  assert.equal(h.length, 2);
});
test('parse: folded header joins lines', () => {
  const raw = 'Received: from mail.example.com\n        by mx.test.com;\n';
  const h = parseEmailHeaders(raw);
  assert.equal(h.length, 1);
  assert.ok(h[0].value.includes('by mx.test.com'));
});
test('parse: colon in value preserved', () => {
  const h = parseEmailHeaders('Authentication-Results: mx.test.com; spf=pass\n');
  assert.ok(h[0].value.includes('spf=pass'));
});
test('parse: empty input returns empty array', () => {
  assert.deepEqual(parseEmailHeaders(''), []);
});
test('parse: header with angle brackets', () => {
  const h = parseEmailHeaders('Message-ID: <20230601.12345@example.com>\n');
  assert.ok(h[0].value.includes('<'));
});
test('parse: X-Custom header', () => {
  const h = parseEmailHeaders('X-Custom-Header: some value\n');
  assert.equal(h[0].name, 'x-custom-header');
});
test('parse: MIME-Version header', () => {
  const h = parseEmailHeaders('MIME-Version: 1.0\n');
  assert.equal(h[0].name, 'mime-version');
  assert.equal(h[0].value, '1.0');
});

// ── getHeader / getAllHeaders ──────────────────────────────────────────────────

test('getHeader: finds header by name (case-insensitive)', () => {
  const h = parseEmailHeaders('From: test@example.com\n');
  assert.equal(getHeader(h, 'From'), 'test@example.com');
});
test('getHeader: returns null when missing', () => {
  const h = parseEmailHeaders('From: test@example.com\n');
  assert.equal(getHeader(h, 'To'), null);
});
test('getHeader: case-insensitive lookup', () => {
  const h = parseEmailHeaders('Subject: Hello\n');
  assert.equal(getHeader(h, 'SUBJECT'), 'Hello');
});
test('getAllHeaders: returns all matching', () => {
  const raw = 'Received: hop1\nReceived: hop2\nReceived: hop3\n';
  const h = parseEmailHeaders(raw);
  assert.equal(getAllHeaders(h, 'received').length, 3);
});
test('getAllHeaders: returns empty when none', () => {
  const h = parseEmailHeaders('From: a@b.com\n');
  assert.deepEqual(getAllHeaders(h, 'received'), []);
});

// ── extractEmail ──────────────────────────────────────────────────────────────

test('extractEmail: angle bracket format', () => {
  assert.equal(extractEmail('Alice <alice@example.com>'), 'alice@example.com');
});
test('extractEmail: plain format', () => {
  assert.equal(extractEmail('alice@example.com'), 'alice@example.com');
});
test('extractEmail: name with angle brackets', () => {
  assert.equal(extractEmail('"Bob Smith" <bob@smith.com>'), 'bob@smith.com');
});
test('extractEmail: returns null for no email', () => {
  assert.equal(extractEmail('No email here'), null);
});
test('extractEmail: returns null for null input', () => {
  assert.equal(extractEmail(null), null);
});
test('extractEmail: subdomain email', () => {
  assert.equal(extractEmail('<user@mail.example.com>'), 'user@mail.example.com');
});

// ── extractDomain ─────────────────────────────────────────────────────────────

test('extractDomain: simple domain', () => {
  assert.equal(extractDomain('alice@example.com'), 'example.com');
});
test('extractDomain: subdomain preserved', () => {
  assert.equal(extractDomain('user@mail.example.com'), 'mail.example.com');
});
test('extractDomain: returns null for null', () => {
  assert.equal(extractDomain(null), null);
});
test('extractDomain: lowercases domain', () => {
  assert.equal(extractDomain('user@EXAMPLE.COM'), 'example.com');
});
test('extractDomain: no @ returns null', () => {
  assert.equal(extractDomain('notanemail'), null);
});

// ── parseReceivedHeader ───────────────────────────────────────────────────────

test('received: extracts from', () => {
  const r = parseReceivedHeader('from mail.example.com by mx.test.com; Mon, 1 Jan 2024');
  assert.equal(r.from, 'mail.example.com');
});
test('received: extracts by', () => {
  const r = parseReceivedHeader('from mail.example.com by mx.test.com; Mon, 1 Jan 2024');
  assert.equal(r.by, 'mx.test.com');
});
test('received: extracts date', () => {
  const r = parseReceivedHeader('from a by b; Mon, 1 Jan 2024 10:00:00 +0000');
  assert.ok(r.date.includes('2024'));
});
test('received: extracts IP', () => {
  const r = parseReceivedHeader('from mail.example.com ([203.0.113.5]) by mx.test.com');
  assert.equal(r.ip, '203.0.113.5');
});
test('received: no IP returns null', () => {
  const r = parseReceivedHeader('from mail.example.com by mx.test.com');
  assert.equal(r.ip, null);
});
test('received: no from returns null', () => {
  const r = parseReceivedHeader('by mx.test.com with SMTP');
  assert.equal(r.from, null);
});

// ── parseAuthResults ──────────────────────────────────────────────────────────

test('authResults: parses SPF pass', () => {
  const r = parseAuthResults('mx.test.com; spf=pass smtp.mailfrom=user@example.com');
  assert.equal(r.spf, 'pass');
});
test('authResults: parses DKIM pass', () => {
  const r = parseAuthResults('mx.test.com; dkim=pass header.i=@example.com');
  assert.equal(r.dkim, 'pass');
});
test('authResults: parses DMARC pass', () => {
  const r = parseAuthResults('mx.test.com; dmarc=pass (p=REJECT)');
  assert.equal(r.dmarc, 'pass');
});
test('authResults: parses SPF fail', () => {
  const r = parseAuthResults('mx.test.com; spf=fail');
  assert.equal(r.spf, 'fail');
});
test('authResults: parses DKIM fail', () => {
  const r = parseAuthResults('mx.test.com; dkim=fail reason="bad sig"');
  assert.equal(r.dkim, 'fail');
});
test('authResults: null input returns nulls', () => {
  const r = parseAuthResults(null);
  assert.equal(r.spf, null);
  assert.equal(r.dkim, null);
  assert.equal(r.dmarc, null);
});
test('authResults: softfail', () => {
  const r = parseAuthResults('mx; spf=softfail');
  assert.equal(r.spf, 'softfail');
});
test('authResults: all three in one header', () => {
  const r = parseAuthResults('mx; spf=pass; dkim=pass; dmarc=pass');
  assert.equal(r.spf, 'pass');
  assert.equal(r.dkim, 'pass');
  assert.equal(r.dmarc, 'pass');
});

// ── getSpfResult / getDkimResult / getDmarcResult ─────────────────────────────

test('getSpf: from authentication-results', () => {
  const raw = 'Authentication-Results: mx.test.com; spf=pass\n';
  const h = parseEmailHeaders(raw);
  assert.equal(getSpfResult(h), 'pass');
});
test('getSpf: from received-spf', () => {
  const raw = 'Received-SPF: pass (domain designates X as permitted)\n';
  const h = parseEmailHeaders(raw);
  assert.equal(getSpfResult(h), 'pass');
});
test('getSpf: returns null when missing', () => {
  const h = parseEmailHeaders('From: a@b.com\n');
  assert.equal(getSpfResult(h), null);
});
test('getDkim: pass result', () => {
  const raw = 'Authentication-Results: mx; dkim=pass header.i=@example.com\n';
  const h = parseEmailHeaders(raw);
  assert.equal(getDkimResult(h), 'pass');
});
test('getDkim: fail result', () => {
  const raw = 'Authentication-Results: mx; dkim=fail reason="bad"\n';
  const h = parseEmailHeaders(raw);
  assert.equal(getDkimResult(h), 'fail');
});
test('getDkim: returns null when missing', () => {
  const h = parseEmailHeaders('From: a@b.com\n');
  assert.equal(getDkimResult(h), null);
});
test('getDmarc: pass result', () => {
  const raw = 'Authentication-Results: mx; dmarc=pass\n';
  const h = parseEmailHeaders(raw);
  assert.equal(getDmarcResult(h), 'pass');
});
test('getDmarc: fail result', () => {
  const raw = 'Authentication-Results: mx; dmarc=fail action=reject\n';
  const h = parseEmailHeaders(raw);
  assert.equal(getDmarcResult(h), 'fail');
});

// ── isSpam ────────────────────────────────────────────────────────────────────

test('spam: X-Spam-Flag YES is spam', () => {
  const h = parseEmailHeaders('X-Spam-Flag: YES\n');
  assert.ok(isSpam(h));
});
test('spam: X-Spam-Flag NO is not spam', () => {
  const h = parseEmailHeaders('X-Spam-Flag: NO\n');
  assert.ok(!isSpam(h));
});
test('spam: high score is spam', () => {
  const h = parseEmailHeaders('X-Spam-Score: 8.5\n');
  assert.ok(isSpam(h));
});
test('spam: low score not spam', () => {
  const h = parseEmailHeaders('X-Spam-Score: 1.2\n');
  assert.ok(!isSpam(h));
});
test('spam: exactly 5 not spam', () => {
  const h = parseEmailHeaders('X-Spam-Score: 5\n');
  assert.ok(!isSpam(h));
});
test('spam: no spam headers not spam', () => {
  const h = parseEmailHeaders('From: a@b.com\n');
  assert.ok(!isSpam(h));
});

// ── getRoutingHops ────────────────────────────────────────────────────────────

test('hops: single received header', () => {
  const raw = 'Received: from mail.a.com by mx.b.com; Mon, 1 Jan 2024\n';
  const h = parseEmailHeaders(raw);
  const hops = getRoutingHops(h);
  assert.equal(hops.length, 1);
  assert.equal(hops[0].num, 1);
});
test('hops: three received headers', () => {
  const raw = 'Received: from a by b\nReceived: from c by d\nReceived: from e by f\n';
  const h = parseEmailHeaders(raw);
  const hops = getRoutingHops(h);
  assert.equal(hops.length, 3);
});
test('hops: no received returns empty', () => {
  const h = parseEmailHeaders('From: a@b.com\n');
  assert.deepEqual(getRoutingHops(h), []);
});
test('hops: from field extracted', () => {
  const raw = 'Received: from sendinghost.com by mx.example.com\n';
  const h = parseEmailHeaders(raw);
  assert.equal(getRoutingHops(h)[0].from, 'sendinghost.com');
});

// ── analyzeEmailHeaders integration ──────────────────────────────────────────

test('analyze: parses From field', () => {
  const raw = 'From: Alice <alice@example.com>\nTo: bob@test.com\nSubject: Hi\n';
  const r = analyzeEmailHeaders(raw);
  assert.ok(r.summary.from.includes('alice@example.com'));
});
test('analyze: fromEmail extracted', () => {
  const raw = 'From: Alice <alice@example.com>\n';
  const r = analyzeEmailHeaders(raw);
  assert.equal(r.fromEmail, 'alice@example.com');
});
test('analyze: fromDomain extracted', () => {
  const raw = 'From: Alice <alice@example.com>\n';
  const r = analyzeEmailHeaders(raw);
  assert.equal(r.fromDomain, 'example.com');
});
test('analyze: auth results extracted', () => {
  const raw = 'Authentication-Results: mx; spf=pass; dkim=pass; dmarc=pass\n';
  const r = analyzeEmailHeaders(raw);
  assert.equal(r.auth.spf, 'pass');
  assert.equal(r.auth.dkim, 'pass');
  assert.equal(r.auth.dmarc, 'pass');
});
test('analyze: reply-to domain mismatch warning', () => {
  const raw = 'From: sender@legit.com\nReply-To: attacker@evil.com\n';
  const r = analyzeEmailHeaders(raw);
  assert.ok(r.warnings.some(w => w.includes('Reply-To')));
});
test('analyze: spf fail warning', () => {
  const raw = 'From: user@example.com\nAuthentication-Results: mx; spf=fail\n';
  const r = analyzeEmailHeaders(raw);
  assert.ok(r.warnings.some(w => w.includes('SPF')));
});
test('analyze: dkim fail warning', () => {
  const raw = 'From: user@example.com\nAuthentication-Results: mx; dkim=fail\n';
  const r = analyzeEmailHeaders(raw);
  assert.ok(r.warnings.some(w => w.includes('DKIM')));
});
test('analyze: dmarc fail warning', () => {
  const raw = 'From: user@example.com\nAuthentication-Results: mx; dmarc=fail\n';
  const r = analyzeEmailHeaders(raw);
  assert.ok(r.warnings.some(w => w.includes('DMARC')));
});
test('analyze: spam flag triggers warning', () => {
  const raw = 'From: user@example.com\nX-Spam-Flag: YES\n';
  const r = analyzeEmailHeaders(raw);
  assert.ok(r.warnings.some(w => w.includes('spam')));
});
test('analyze: clean email no warnings', () => {
  const raw = 'From: user@example.com\nTo: other@example.com\nSubject: Hello\nAuthentication-Results: mx; spf=pass; dkim=pass; dmarc=pass\n';
  const r = analyzeEmailHeaders(raw);
  assert.equal(r.warnings.length, 0);
});
test('analyze: headers array returned', () => {
  const r = analyzeEmailHeaders('From: a@b.com\n');
  assert.ok(Array.isArray(r.headers));
});
test('analyze: hops array returned', () => {
  const r = analyzeEmailHeaders('From: a@b.com\n');
  assert.ok(Array.isArray(r.hops));
});
test('analyze: subject extracted', () => {
  const raw = 'From: a@b.com\nSubject: Test Message\n';
  const r = analyzeEmailHeaders(raw);
  assert.equal(r.summary.subject, 'Test Message');
});
test('analyze: message-id extracted', () => {
  const raw = 'From: a@b.com\nMessage-ID: <msg123@test.com>\n';
  const r = analyzeEmailHeaders(raw);
  assert.ok(r.summary.messageId.includes('msg123'));
});
test('analyze: softfail SPF triggers warning', () => {
  const raw = 'From: user@example.com\nAuthentication-Results: mx; spf=softfail\n';
  const r = analyzeEmailHeaders(raw);
  assert.ok(r.warnings.some(w => w.includes('softfail')));
});
test('analyze: to field extracted', () => {
  const raw = 'From: a@b.com\nTo: bob@test.com\n';
  const r = analyzeEmailHeaders(raw);
  assert.equal(r.summary.to, 'bob@test.com');
});
test('analyze: date field extracted', () => {
  const raw = 'From: a@b.com\nDate: Mon, 1 Jan 2024 10:00:00 +0000\n';
  const r = analyzeEmailHeaders(raw);
  assert.ok(r.summary.date.includes('2024'));
});
test('analyze: return-path mismatch warning', () => {
  const raw = 'From: user@legit.com\nReturn-Path: <bounce@different.com>\n';
  const r = analyzeEmailHeaders(raw);
  assert.ok(r.warnings.some(w => w.includes('Return-Path')));
});
test('extractEmail: plus in local part', () => {
  assert.equal(extractEmail('user+tag@example.com'), 'user+tag@example.com');
});
test('extractDomain: handles org TLD', () => {
  assert.equal(extractDomain('user@example.org'), 'example.org');
});
test('parse: Content-Type header', () => {
  const h = parseEmailHeaders('Content-Type: text/html; charset=utf-8\n');
  assert.equal(h[0].name, 'content-type');
  assert.ok(h[0].value.includes('text/html'));
});

console.log(`\nAll ${passed} tests passed.`);
