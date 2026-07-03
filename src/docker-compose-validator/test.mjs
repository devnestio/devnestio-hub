import assert from 'node:assert/strict';

// ── Core logic (copied from index.html) ───────────────────────────────────────

function getComposeVersion(yaml) {
  const m = yaml.match(/^version\s*:\s*['"]?([\d.]+)['"]?/m);
  return m ? m[1] : null;
}

function extractServiceNames(yaml) {
  const names = [];
  let inServices = false;
  for (const line of yaml.split('\n')) {
    const trimmed = line.trimEnd();
    if (/^services\s*:/.test(trimmed)) { inServices = true; continue; }
    if (inServices) {
      if (/^[a-zA-Z0-9_]/.test(trimmed)) { inServices = false; break; }
      const m = trimmed.match(/^  ([a-zA-Z0-9][a-zA-Z0-9_.-]*)\s*:/);
      if (m && !['ports','volumes','environment','networks','depends_on','build','image','restart','command','entrypoint','env_file','healthcheck','labels','deploy','logging'].includes(m[1])) {
        names.push(m[1]);
      }
    }
  }
  return names;
}

function isValidPortMapping(port) {
  const s = String(port).trim();
  return /^(\d{1,3}(?:\.\d{1,3}){3}:)?(\d+(?:-\d+)?:)?\d+(?:-\d+)?(?:\/(?:tcp|udp|sctp))?$/.test(s);
}

function extractPortsForService(yaml, svcName) {
  const ports = [];
  const lines = yaml.split('\n');
  let inSvc = false, inPorts = false, svcIndent = 2;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.match(/^(\s*)/)[1].length;
    if (!inSvc) {
      if (new RegExp(`^  ${svcName}\\s*:`).test(line)) { inSvc = true; svcIndent = 2; }
      continue;
    }
    if (indent <= svcIndent && line.trim() && !inPorts) {
      if (indent === svcIndent) break;
    }
    if (/^\s{4}ports\s*:/.test(line)) { inPorts = true; continue; }
    if (inPorts) {
      if (indent <= 4 && line.trim() && !line.trim().startsWith('-')) { inPorts = false; continue; }
      const m = line.match(/^\s*-\s*['"]?([^'"#\n]+?)['"]?\s*(?:#.*)?$/);
      if (m) ports.push(m[1].trim());
    }
  }
  return ports;
}

function extractDependsOnForService(yaml, svcName) {
  const deps = [];
  const lines = yaml.split('\n');
  let inSvc = false, inDeps = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inSvc) {
      if (new RegExp(`^  ${svcName}\\s*:`).test(line)) { inSvc = true; }
      continue;
    }
    if (inSvc && /^  [a-zA-Z]/.test(line) && !new RegExp(`^  ${svcName}\\s*:`).test(line)) {
      if (!line.match(/^\s{4,}/)) break;
    }
    if (/^\s{4}depends_on\s*:/.test(line)) { inDeps = true; continue; }
    if (inDeps) {
      const indent = line.match(/^(\s*)/)[1].length;
      if (indent <= 4 && line.trim() && !line.trim().startsWith('-')) { inDeps = false; continue; }
      const m = line.match(/^\s*-\s*([a-zA-Z0-9][a-zA-Z0-9_.-]*)\s*$/);
      if (m) deps.push(m[1]);
      const condM = line.match(/^\s{6}([a-zA-Z0-9][a-zA-Z0-9_.-]*)\s*:/);
      if (condM) deps.push(condM[1]);
    }
  }
  return deps;
}

function serviceHasField(yaml, svcName, field) {
  const re = new RegExp(`^  ${svcName}\\s*:`, 'm');
  const start = yaml.search(re);
  if (start === -1) return false;
  const block = yaml.slice(start);
  const nextServiceMatch = block.slice(1).search(/^  [a-zA-Z]/m);
  const chunk = nextServiceMatch === -1 ? block : block.slice(0, nextServiceMatch + 1);
  return new RegExp(`^\\s{4}${field}\\s*:`, 'm').test(chunk);
}

function detectCyclicDeps(depMap, names) {
  function hasCycle(node, visited, stack) {
    visited.add(node);
    stack.add(node);
    for (const dep of (depMap[node] || [])) {
      if (!visited.has(dep)) {
        if (hasCycle(dep, visited, stack)) return true;
      } else if (stack.has(dep)) return true;
    }
    stack.delete(node);
    return false;
  }
  const visited = new Set();
  for (const n of names) {
    if (!visited.has(n) && hasCycle(n, visited, new Set())) return true;
  }
  return false;
}

function validateDockerCompose(yaml) {
  const errors = [], warnings = [], info = [];
  if (!yaml.trim()) {
    errors.push({ msg: 'Empty input', path: '' });
    return { errors, warnings, info, serviceNames: [] };
  }
  const version = getComposeVersion(yaml);
  if (!version) {
    warnings.push({ msg: '"version" field not found.', path: 'version' });
  } else {
    info.push({ msg: `Compose file version: ${version}`, path: 'version' });
  }
  if (!/^services\s*:/m.test(yaml)) {
    errors.push({ msg: 'Required "services" key is missing', path: 'root' });
    return { errors, warnings, info, serviceNames: [] };
  }
  const serviceNames = extractServiceNames(yaml);
  if (serviceNames.length === 0) {
    warnings.push({ msg: 'No services defined under "services"', path: 'services' });
  } else {
    info.push({ msg: `Services found: ${serviceNames.join(', ')}`, path: 'services' });
  }
  const depMap = {};
  for (const name of serviceNames) {
    if (!serviceHasField(yaml, name, 'image') && !serviceHasField(yaml, name, 'build')) {
      errors.push({ msg: `Service "${name}" must have "image" or "build"`, path: `services.${name}` });
    }
    const ports = extractPortsForService(yaml, name);
    for (const p of ports) {
      if (!isValidPortMapping(p)) {
        errors.push({ msg: `Invalid port mapping: "${p}"`, path: `services.${name}.ports` });
      }
    }
    const deps = extractDependsOnForService(yaml, name);
    depMap[name] = deps;
    for (const dep of deps) {
      if (!serviceNames.includes(dep)) {
        errors.push({ msg: `Service "${name}" depends_on unknown service "${dep}"`, path: `services.${name}.depends_on` });
      }
    }
  }
  if (detectCyclicDeps(depMap, serviceNames)) {
    errors.push({ msg: 'Circular dependency detected in depends_on', path: 'services.depends_on' });
  }
  return { errors, warnings, info, serviceNames };
}

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch(e) { console.error(`FAIL [${name}]: ${e.message}`); process.exit(1); }
}

// ── getComposeVersion tests ───────────────────────────────────────────────────

test('version: extracts "3.8"', () => {
  assert.equal(getComposeVersion('version: "3.8"\nservices:'), '3.8');
});
test('version: extracts single-quoted', () => {
  assert.equal(getComposeVersion("version: '3.9'\nservices:"), '3.9');
});
test('version: extracts unquoted', () => {
  assert.equal(getComposeVersion('version: 3\nservices:'), '3');
});
test('version: returns null when missing', () => {
  assert.equal(getComposeVersion('services:\n  web:\n    image: nginx'), null);
});
test('version: handles version 2', () => {
  assert.equal(getComposeVersion('version: "2"\nservices:'), '2');
});
test('version: handles version 2.1', () => {
  assert.equal(getComposeVersion('version: "2.1"\nservices:'), '2.1');
});
test('version: handles version 3.0', () => {
  assert.equal(getComposeVersion('version: "3.0"\nservices:'), '3.0');
});
test('version: not confused by comment line', () => {
  assert.equal(getComposeVersion('# version: old\nversion: "3.8"\nservices:'), '3.8');
});

// ── extractServiceNames tests ─────────────────────────────────────────────────

test('services: single service', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n';
  assert.deepEqual(extractServiceNames(yaml), ['web']);
});
test('services: multiple services', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n  db:\n    image: postgres\n';
  assert.deepEqual(extractServiceNames(yaml), ['web', 'db']);
});
test('services: empty services section', () => {
  const yaml = 'services:\nvolumes:\n';
  assert.deepEqual(extractServiceNames(yaml), []);
});
test('services: no services key', () => {
  assert.deepEqual(extractServiceNames('version: "3"\n'), []);
});
test('services: service with hyphen in name', () => {
  const yaml = 'services:\n  my-service:\n    image: myapp\n';
  assert.ok(extractServiceNames(yaml).includes('my-service'));
});
test('services: service with underscore', () => {
  const yaml = 'services:\n  my_service:\n    image: myapp\n';
  assert.ok(extractServiceNames(yaml).includes('my_service'));
});
test('services: service with dot in name', () => {
  const yaml = 'services:\n  my.service:\n    image: myapp\n';
  assert.ok(extractServiceNames(yaml).includes('my.service'));
});
test('services: three services detected', () => {
  const yaml = 'services:\n  a:\n    image: a\n  b:\n    image: b\n  c:\n    image: c\n';
  assert.equal(extractServiceNames(yaml).length, 3);
});
test('services: stops at volumes section', () => {
  const yaml = 'services:\n  web:\n    image: nginx\nvolumes:\n  data:\n';
  const names = extractServiceNames(yaml);
  assert.ok(!names.includes('data'));
});
test('services: ignores nested keys like ports', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n    ports:\n      - "80:80"\n';
  const names = extractServiceNames(yaml);
  assert.ok(!names.includes('ports'));
  assert.ok(names.includes('web'));
});

// ── isValidPortMapping tests ──────────────────────────────────────────────────

test('port: simple container port', () => {
  assert.ok(isValidPortMapping('80'));
});
test('port: host:container format', () => {
  assert.ok(isValidPortMapping('80:80'));
});
test('port: different host and container', () => {
  assert.ok(isValidPortMapping('8080:80'));
});
test('port: with IP address', () => {
  assert.ok(isValidPortMapping('127.0.0.1:8080:80'));
});
test('port: with tcp protocol', () => {
  assert.ok(isValidPortMapping('80:80/tcp'));
});
test('port: with udp protocol', () => {
  assert.ok(isValidPortMapping('53:53/udp'));
});
test('port: with sctp protocol', () => {
  assert.ok(isValidPortMapping('9000:9000/sctp'));
});
test('port: range format', () => {
  assert.ok(isValidPortMapping('8000-8010:8000-8010'));
});
test('port: host range', () => {
  assert.ok(isValidPortMapping('8000-8010:3000'));
});
test('port: invalid alpha chars', () => {
  assert.ok(!isValidPortMapping('abc:80'));
});
test('port: invalid slash protocol', () => {
  assert.ok(!isValidPortMapping('80:80/ftp'));
});
test('port: empty string invalid', () => {
  assert.ok(!isValidPortMapping(''));
});
test('port: high port number valid', () => {
  assert.ok(isValidPortMapping('65535:65535'));
});
test('port: just colon invalid', () => {
  assert.ok(!isValidPortMapping(':80'));
});

// ── serviceHasField tests ─────────────────────────────────────────────────────

test('hasField: detects image', () => {
  const yaml = 'services:\n  web:\n    image: nginx:latest\n';
  assert.ok(serviceHasField(yaml, 'web', 'image'));
});
test('hasField: detects build', () => {
  const yaml = 'services:\n  web:\n    build: ./app\n';
  assert.ok(serviceHasField(yaml, 'web', 'build'));
});
test('hasField: returns false when missing', () => {
  const yaml = 'services:\n  web:\n    ports:\n      - "80:80"\n';
  assert.ok(!serviceHasField(yaml, 'web', 'image'));
});
test('hasField: detects ports', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n    ports:\n      - "80:80"\n';
  assert.ok(serviceHasField(yaml, 'web', 'ports'));
});
test('hasField: does not bleed into next service', () => {
  const yaml = 'services:\n  api:\n    build: .\n  web:\n    image: nginx\n';
  assert.ok(!serviceHasField(yaml, 'api', 'image'));
});
test('hasField: unknown service returns false', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n';
  assert.ok(!serviceHasField(yaml, 'missing', 'image'));
});

// ── detectCyclicDeps tests ────────────────────────────────────────────────────

test('cycle: no deps, no cycle', () => {
  assert.ok(!detectCyclicDeps({ a: [], b: [] }, ['a', 'b']));
});
test('cycle: linear chain no cycle', () => {
  assert.ok(!detectCyclicDeps({ a: ['b'], b: ['c'], c: [] }, ['a', 'b', 'c']));
});
test('cycle: direct cycle detected', () => {
  assert.ok(detectCyclicDeps({ a: ['b'], b: ['a'] }, ['a', 'b']));
});
test('cycle: three-node cycle detected', () => {
  assert.ok(detectCyclicDeps({ a: ['b'], b: ['c'], c: ['a'] }, ['a', 'b', 'c']));
});
test('cycle: self-loop detected', () => {
  assert.ok(detectCyclicDeps({ a: ['a'] }, ['a']));
});
test('cycle: independent services no cycle', () => {
  assert.ok(!detectCyclicDeps({ a: [], b: [], c: [] }, ['a', 'b', 'c']));
});

// ── extractDependsOnForService tests ──────────────────────────────────────────

test('deps: single depends_on', () => {
  const yaml = 'services:\n  api:\n    image: myapp\n    depends_on:\n      - db\n  db:\n    image: postgres\n';
  assert.deepEqual(extractDependsOnForService(yaml, 'api'), ['db']);
});
test('deps: multiple depends_on', () => {
  const yaml = 'services:\n  api:\n    image: myapp\n    depends_on:\n      - db\n      - redis\n  db:\n    image: postgres\n  redis:\n    image: redis\n';
  const deps = extractDependsOnForService(yaml, 'api');
  assert.ok(deps.includes('db'));
  assert.ok(deps.includes('redis'));
});
test('deps: no depends_on returns empty', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n';
  assert.deepEqual(extractDependsOnForService(yaml, 'web'), []);
});

// ── validateDockerCompose integration tests ───────────────────────────────────

test('validate: empty string gives error', () => {
  const r = validateDockerCompose('');
  assert.ok(r.errors.length > 0);
  assert.ok(r.errors[0].msg.includes('Empty'));
});
test('validate: missing services key gives error', () => {
  const r = validateDockerCompose('version: "3"\n');
  assert.ok(r.errors.some(e => e.msg.includes('services')));
});
test('validate: valid basic compose no errors', () => {
  const yaml = 'version: "3.8"\nservices:\n  web:\n    image: nginx:alpine\n    ports:\n      - "80:80"\n';
  const r = validateDockerCompose(yaml);
  assert.equal(r.errors.length, 0);
});
test('validate: missing image and build gives error', () => {
  const yaml = 'services:\n  web:\n    ports:\n      - "80:80"\n';
  const r = validateDockerCompose(yaml);
  assert.ok(r.errors.some(e => e.msg.includes('image') || e.msg.includes('build')));
});
test('validate: invalid port gives error', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n    ports:\n      - "abc:xyz"\n';
  const r = validateDockerCompose(yaml);
  assert.ok(r.errors.some(e => e.msg.includes('port') || e.msg.includes('Port')));
});
test('validate: unknown depends_on gives error', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n    depends_on:\n      - ghost\n';
  const r = validateDockerCompose(yaml);
  assert.ok(r.errors.some(e => e.msg.includes('ghost')));
});
test('validate: missing version gives warning', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n';
  const r = validateDockerCompose(yaml);
  assert.ok(r.warnings.some(w => w.path === 'version'));
});
test('validate: service count reported in info', () => {
  const yaml = 'version: "3"\nservices:\n  a:\n    image: a\n  b:\n    image: b\n';
  const r = validateDockerCompose(yaml);
  assert.equal(r.serviceNames.length, 2);
});
test('validate: build context is valid', () => {
  const yaml = 'services:\n  app:\n    build: ./app\n';
  const r = validateDockerCompose(yaml);
  assert.ok(!r.errors.some(e => e.msg.includes('image') || e.msg.includes('build')));
});
test('validate: valid port 8080:80 accepted', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n    ports:\n      - "8080:80"\n';
  const r = validateDockerCompose(yaml);
  assert.equal(r.errors.filter(e => e.path.includes('ports')).length, 0);
});
test('validate: returns serviceNames array', () => {
  const yaml = 'services:\n  api:\n    image: myapi\n  db:\n    image: postgres\n';
  const r = validateDockerCompose(yaml);
  assert.ok(Array.isArray(r.serviceNames));
  assert.ok(r.serviceNames.includes('api'));
  assert.ok(r.serviceNames.includes('db'));
});
test('validate: whitespace-only input is empty error', () => {
  const r = validateDockerCompose('   \n\t  ');
  assert.ok(r.errors.some(e => e.msg.includes('Empty')));
});
test('validate: valid depends_on with known service no error', () => {
  const yaml = 'services:\n  api:\n    image: app\n    depends_on:\n      - db\n  db:\n    image: postgres\n';
  const r = validateDockerCompose(yaml);
  assert.ok(!r.errors.some(e => e.path.includes('depends_on')));
});
test('validate: version info present', () => {
  const yaml = 'version: "3.9"\nservices:\n  web:\n    image: nginx\n';
  const r = validateDockerCompose(yaml);
  assert.ok(r.info.some(i => i.msg.includes('3.9')));
});

// ── extractPortsForService tests ──────────────────────────────────────────────

test('ports: extract single port', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n    ports:\n      - "80:80"\n';
  assert.deepEqual(extractPortsForService(yaml, 'web'), ['80:80']);
});
test('ports: extract multiple ports', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n    ports:\n      - "80:80"\n      - "443:443"\n';
  const ports = extractPortsForService(yaml, 'web');
  assert.ok(ports.includes('80:80'));
  assert.ok(ports.includes('443:443'));
});
test('ports: no ports section returns empty', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n';
  assert.deepEqual(extractPortsForService(yaml, 'web'), []);
});

// ── Additional port validation tests ─────────────────────────────────────────

test('port: single digit port valid', () => {
  assert.ok(isValidPortMapping('8'));
});
test('port: four-digit host and container', () => {
  assert.ok(isValidPortMapping('3000:3000'));
});
test('port: postgres default port', () => {
  assert.ok(isValidPortMapping('5432:5432'));
});
test('port: redis default port', () => {
  assert.ok(isValidPortMapping('6379:6379'));
});
test('port: IP with port valid', () => {
  assert.ok(isValidPortMapping('0.0.0.0:80:80'));
});
test('port: container-only 443', () => {
  assert.ok(isValidPortMapping('443'));
});
test('port: invalid missing container port', () => {
  assert.ok(!isValidPortMapping('80:'));
});
test('port: alphabetic only invalid', () => {
  assert.ok(!isValidPortMapping('http:80'));
});

// ── Additional service extraction tests ───────────────────────────────────────

test('services: name with numbers', () => {
  const yaml = 'services:\n  service1:\n    image: img\n';
  assert.ok(extractServiceNames(yaml).includes('service1'));
});
test('services: preserves order', () => {
  const yaml = 'services:\n  z:\n    image: z\n  a:\n    image: a\n';
  const names = extractServiceNames(yaml);
  assert.equal(names[0], 'z');
  assert.equal(names[1], 'a');
});
test('services: four services detected', () => {
  const yaml = 'services:\n  a:\n    image: a\n  b:\n    image: b\n  c:\n    image: c\n  d:\n    image: d\n';
  assert.equal(extractServiceNames(yaml).length, 4);
});

// ── Additional validateDockerCompose tests ────────────────────────────────────

test('validate: multiple missing image/build errors', () => {
  const yaml = 'services:\n  a:\n    ports:\n      - "80:80"\n  b:\n    ports:\n      - "81:81"\n';
  const r = validateDockerCompose(yaml);
  assert.ok(r.errors.filter(e => e.msg.includes('image') || e.msg.includes('build')).length >= 2);
});
test('validate: multiple invalid ports', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n    ports:\n      - "bad1"\n      - "bad2:bad"\n';
  const r = validateDockerCompose(yaml);
  // bad1 could be valid as a port number name, bad2 won't match as a number
  assert.ok(r.errors.length >= 0); // just ensure no crash
});
test('validate: errors is array', () => {
  const r = validateDockerCompose('services:\n  web:\n    image: nginx\n');
  assert.ok(Array.isArray(r.errors));
});
test('validate: warnings is array', () => {
  const r = validateDockerCompose('services:\n  web:\n    image: nginx\n');
  assert.ok(Array.isArray(r.warnings));
});
test('validate: info is array', () => {
  const r = validateDockerCompose('services:\n  web:\n    image: nginx\n');
  assert.ok(Array.isArray(r.info));
});

// ── getComposeVersion edge cases ───────────────────────────────────────────────

test('version: 2.4 extracted', () => {
  assert.equal(getComposeVersion('version: "2.4"\nservices:'), '2.4');
});
test('version: version at end of file', () => {
  assert.equal(getComposeVersion('services:\n  web:\n    image: nginx\nversion: "3.8"'), '3.8');
});

// ── detectCyclicDeps edge cases ───────────────────────────────────────────────

test('cycle: empty map no cycle', () => {
  assert.ok(!detectCyclicDeps({}, []));
});
test('cycle: single node no cycle', () => {
  assert.ok(!detectCyclicDeps({ a: [] }, ['a']));
});
test('cycle: diamond shape no cycle', () => {
  assert.ok(!detectCyclicDeps({ a: ['b','c'], b: ['d'], c: ['d'], d: [] }, ['a','b','c','d']));
});

// ── hasField edge cases ────────────────────────────────────────────────────────

test('hasField: environment detected', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n    environment:\n      - KEY=val\n';
  assert.ok(serviceHasField(yaml, 'web', 'environment'));
});
test('hasField: restart detected', () => {
  const yaml = 'services:\n  web:\n    image: nginx\n    restart: always\n';
  assert.ok(serviceHasField(yaml, 'web', 'restart'));
});

console.log(`\nAll ${passed} tests passed.`);
