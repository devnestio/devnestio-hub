import assert from 'node:assert/strict';

// ── Core logic (copied from index.html) ───────────────────────────────────────

function parseDockerfileInstructions(src) {
  const lines = src.split('\n');
  const instructions = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) { i++; continue; }
    const m = trimmed.match(/^([A-Z]+)\s*(.*)/);
    if (!m) { i++; continue; }
    let value = m[2];
    while (value.endsWith('\\') && i + 1 < lines.length) {
      value = value.slice(0, -1).trim();
      i++;
      value += ' ' + lines[i].trim();
    }
    instructions.push({ instruction: m[1], value: value.trim(), line: i + 1 });
    i++;
  }
  return instructions;
}

function getBaseImages(instructions) {
  return instructions.filter(i => i.instruction === 'FROM').map(i => i.value);
}

function isLatestTag(image) {
  const parts = image.split(' ')[0];
  if (parts === 'scratch') return false;
  const tag = parts.includes(':') ? parts.split(':').pop() : 'latest';
  return tag === 'latest';
}

function isPinnedDigest(image) {
  const parts = image.split(' ')[0];
  return parts.includes('@sha256:');
}

function hasLatestTagImage(instructions) {
  return getBaseImages(instructions).some(img => isLatestTag(img));
}

function isMultiStage(instructions) {
  const froms = instructions.filter(i => i.instruction === 'FROM');
  return froms.length > 1;
}

function getRunInstructions(instructions) {
  return instructions.filter(i => i.instruction === 'RUN');
}

function hasAptGetUpdateWithoutInstall(instructions) {
  const runs = getRunInstructions(instructions);
  for (const r of runs) {
    if (r.value.includes('apt-get update') && !r.value.includes('apt-get install')) {
      return true;
    }
  }
  return false;
}

function hasAptGetInstallWithoutNoRecommends(instructions) {
  const runs = getRunInstructions(instructions);
  return runs.some(r =>
    r.value.includes('apt-get install') && !r.value.includes('--no-install-recommends')
  );
}

function hasAptCacheNotCleaned(instructions) {
  const runs = getRunInstructions(instructions);
  return runs.some(r =>
    r.value.includes('apt-get install') &&
    !r.value.includes('rm -rf /var/lib/apt/lists')
  );
}

function hasAddInsteadOfCopy(instructions) {
  return instructions.some(i => i.instruction === 'ADD' && !i.value.startsWith('http'));
}

function hasSudoUsage(instructions) {
  const runs = getRunInstructions(instructions);
  return runs.some(r => /\bsudo\b/.test(r.value));
}

function hasRootUser(instructions) {
  const users = instructions.filter(i => i.instruction === 'USER');
  if (users.length === 0) return true;
  const lastUser = users[users.length - 1].value.trim().toLowerCase();
  return lastUser === 'root' || lastUser === '0';
}

function hasSensitiveEnvVar(instructions) {
  const envs = instructions.filter(i => i.instruction === 'ENV' || i.instruction === 'ARG');
  const sensitiveKeys = /password|secret|token|key|api_key|private/i;
  return envs.some(e => sensitiveKeys.test(e.value));
}

function countLayers(instructions) {
  return instructions.filter(i => ['RUN', 'COPY', 'ADD'].includes(i.instruction)).length;
}

function hasConsecutiveRunLayers(instructions) {
  let prev = null;
  for (const ins of instructions) {
    if (ins.instruction === 'RUN' && prev === 'RUN') return true;
    if (!['#', 'LABEL', 'COMMENT'].includes(ins.instruction)) prev = ins.instruction;
  }
  return false;
}

function analyzeDockerfile(src) {
  const errors = [], warnings = [], info = [];
  if (!src.trim()) {
    errors.push({ line: 0, msg: 'Empty Dockerfile', fix: null });
    return { errors, warnings, info, layerCount: 0 };
  }
  const instructions = parseDockerfileInstructions(src);
  if (!instructions.some(i => i.instruction === 'FROM')) {
    errors.push({ line: 0, msg: 'Missing FROM instruction', fix: 'Add a FROM instruction as the first line' });
  }
  if (hasLatestTagImage(instructions)) {
    warnings.push({ line: null, msg: 'Base image uses :latest tag — pinning to a specific version prevents unexpected updates', fix: 'Use FROM node:20-alpine instead of FROM node:latest' });
  }
  if (hasAptGetUpdateWithoutInstall(instructions)) {
    warnings.push({ line: null, msg: 'apt-get update without apt-get install in same RUN layer', fix: 'Combine: RUN apt-get update && apt-get install -y ...' });
  }
  if (hasAptGetInstallWithoutNoRecommends(instructions)) {
    warnings.push({ line: null, msg: 'apt-get install without --no-install-recommends', fix: 'Use: apt-get install -y --no-install-recommends <packages>' });
  }
  if (hasAptCacheNotCleaned(instructions)) {
    warnings.push({ line: null, msg: 'apt cache not cleaned after install', fix: 'Add: && rm -rf /var/lib/apt/lists/*' });
  }
  if (hasAddInsteadOfCopy(instructions)) {
    warnings.push({ line: null, msg: 'ADD used for local files — prefer COPY', fix: 'Replace ADD with COPY for local file copies' });
  }
  if (hasSudoUsage(instructions)) {
    errors.push({ line: null, msg: 'sudo is used — containers should not rely on sudo', fix: 'Use USER instruction to switch user' });
  }
  if (hasRootUser(instructions)) {
    warnings.push({ line: null, msg: 'Container runs as root', fix: 'Add USER app instruction' });
  }
  if (hasSensitiveEnvVar(instructions)) {
    errors.push({ line: null, msg: 'Sensitive value found in ENV/ARG', fix: 'Use Docker secrets or pass as runtime env vars with -e' });
  }
  if (hasConsecutiveRunLayers(instructions)) {
    warnings.push({ line: null, msg: 'Consecutive RUN instructions detected', fix: 'RUN cmd1 && cmd2 && cmd3' });
  }
  const layerCount = countLayers(instructions);
  info.push({ line: null, msg: `Total image layers (RUN/COPY/ADD): ${layerCount}` });
  if (layerCount > 15) {
    warnings.push({ line: null, msg: `High layer count (${layerCount})` });
  }
  if (isMultiStage(instructions)) {
    info.push({ line: null, msg: 'Multi-stage build detected' });
  }
  if (instructions.some(i => i.instruction === 'HEALTHCHECK')) {
    info.push({ line: null, msg: 'HEALTHCHECK instruction found' });
  }
  if (!instructions.some(i => i.instruction === 'WORKDIR')) {
    warnings.push({ line: null, msg: 'No WORKDIR instruction', fix: 'Add: WORKDIR /app' });
  }
  return { errors, warnings, info, layerCount, instructions };
}

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch(e) { console.error(`FAIL [${name}]: ${e.message}`); process.exit(1); }
}

// ── parseDockerfileInstructions ───────────────────────────────────────────────

test('parse: FROM instruction', () => {
  const ins = parseDockerfileInstructions('FROM node:20-alpine\n');
  assert.equal(ins.length, 1);
  assert.equal(ins[0].instruction, 'FROM');
  assert.equal(ins[0].value, 'node:20-alpine');
});
test('parse: skips empty lines', () => {
  const ins = parseDockerfileInstructions('\n\nFROM alpine\n\n');
  assert.equal(ins.length, 1);
});
test('parse: skips comment lines', () => {
  const ins = parseDockerfileInstructions('# this is a comment\nFROM alpine\n');
  assert.equal(ins.length, 1);
  assert.equal(ins[0].instruction, 'FROM');
});
test('parse: multiple instructions', () => {
  const src = 'FROM node:20\nWORKDIR /app\nCOPY . .\nRUN npm install\n';
  const ins = parseDockerfileInstructions(src);
  assert.equal(ins.length, 4);
});
test('parse: RUN instruction', () => {
  const ins = parseDockerfileInstructions('RUN npm install\n');
  assert.equal(ins[0].instruction, 'RUN');
  assert.equal(ins[0].value, 'npm install');
});
test('parse: COPY instruction', () => {
  const ins = parseDockerfileInstructions('COPY . /app\n');
  assert.equal(ins[0].instruction, 'COPY');
  assert.equal(ins[0].value, '. /app');
});
test('parse: WORKDIR instruction', () => {
  const ins = parseDockerfileInstructions('WORKDIR /app\n');
  assert.equal(ins[0].instruction, 'WORKDIR');
  assert.equal(ins[0].value, '/app');
});
test('parse: ENV instruction', () => {
  const ins = parseDockerfileInstructions('ENV NODE_ENV=production\n');
  assert.equal(ins[0].instruction, 'ENV');
});
test('parse: EXPOSE instruction', () => {
  const ins = parseDockerfileInstructions('EXPOSE 3000\n');
  assert.equal(ins[0].instruction, 'EXPOSE');
});
test('parse: CMD instruction', () => {
  const ins = parseDockerfileInstructions('CMD ["node", "index.js"]\n');
  assert.equal(ins[0].instruction, 'CMD');
});
test('parse: USER instruction', () => {
  const ins = parseDockerfileInstructions('USER app\n');
  assert.equal(ins[0].instruction, 'USER');
  assert.equal(ins[0].value, 'app');
});
test('parse: ADD instruction', () => {
  const ins = parseDockerfileInstructions('ADD ./app /app\n');
  assert.equal(ins[0].instruction, 'ADD');
});
test('parse: HEALTHCHECK instruction', () => {
  const ins = parseDockerfileInstructions('HEALTHCHECK CMD curl -f http://localhost/health\n');
  assert.equal(ins[0].instruction, 'HEALTHCHECK');
});
test('parse: line continuation', () => {
  const src = 'RUN apt-get update \\\n    && apt-get install -y curl\n';
  const ins = parseDockerfileInstructions(src);
  assert.equal(ins.length, 1);
  assert.ok(ins[0].value.includes('curl'));
});

// ── isLatestTag ───────────────────────────────────────────────────────────────

test('latest: node:latest is latest', () => {
  assert.ok(isLatestTag('node:latest'));
});
test('latest: node without tag is latest', () => {
  assert.ok(isLatestTag('node'));
});
test('latest: ubuntu:latest is latest', () => {
  assert.ok(isLatestTag('ubuntu:latest'));
});
test('latest: node:20 is not latest', () => {
  assert.ok(!isLatestTag('node:20'));
});
test('latest: node:20-alpine is not latest', () => {
  assert.ok(!isLatestTag('node:20-alpine'));
});
test('latest: scratch is not latest', () => {
  assert.ok(!isLatestTag('scratch'));
});
test('latest: alpine:3.18 is not latest', () => {
  assert.ok(!isLatestTag('alpine:3.18'));
});
test('latest: FROM with AS alias', () => {
  assert.ok(isLatestTag('node AS builder'));
});
test('latest: pinned version not latest', () => {
  assert.ok(!isLatestTag('node:18.17.0'));
});

// ── isPinnedDigest ────────────────────────────────────────────────────────────

test('digest: sha256 pinned', () => {
  assert.ok(isPinnedDigest('node@sha256:abc123'));
});
test('digest: no digest not pinned', () => {
  assert.ok(!isPinnedDigest('node:20'));
});

// ── hasLatestTagImage ─────────────────────────────────────────────────────────

test('hasLatest: detects latest', () => {
  const ins = parseDockerfileInstructions('FROM node:latest\n');
  assert.ok(hasLatestTagImage(ins));
});
test('hasLatest: no latest when pinned', () => {
  const ins = parseDockerfileInstructions('FROM node:20\n');
  assert.ok(!hasLatestTagImage(ins));
});

// ── isMultiStage ──────────────────────────────────────────────────────────────

test('multistage: two FROM = multi-stage', () => {
  const ins = parseDockerfileInstructions('FROM node:20 AS build\nFROM node:20-alpine\n');
  assert.ok(isMultiStage(ins));
});
test('multistage: single FROM = not multi-stage', () => {
  const ins = parseDockerfileInstructions('FROM node:20\n');
  assert.ok(!isMultiStage(ins));
});

// ── hasAptGetUpdateWithoutInstall ─────────────────────────────────────────────

test('apt: update without install flagged', () => {
  const ins = parseDockerfileInstructions('RUN apt-get update\n');
  assert.ok(hasAptGetUpdateWithoutInstall(ins));
});
test('apt: update with install combined ok', () => {
  const ins = parseDockerfileInstructions('RUN apt-get update && apt-get install -y curl\n');
  assert.ok(!hasAptGetUpdateWithoutInstall(ins));
});
test('apt: no apt at all returns false', () => {
  const ins = parseDockerfileInstructions('RUN npm install\n');
  assert.ok(!hasAptGetUpdateWithoutInstall(ins));
});

// ── hasAptGetInstallWithoutNoRecommends ───────────────────────────────────────

test('recommends: install without flag flagged', () => {
  const ins = parseDockerfileInstructions('RUN apt-get install -y curl\n');
  assert.ok(hasAptGetInstallWithoutNoRecommends(ins));
});
test('recommends: install with flag ok', () => {
  const ins = parseDockerfileInstructions('RUN apt-get install -y --no-install-recommends curl\n');
  assert.ok(!hasAptGetInstallWithoutNoRecommends(ins));
});

// ── hasAptCacheNotCleaned ─────────────────────────────────────────────────────

test('cache: uncleaned flagged', () => {
  const ins = parseDockerfileInstructions('RUN apt-get install -y curl\n');
  assert.ok(hasAptCacheNotCleaned(ins));
});
test('cache: cleaned ok', () => {
  const ins = parseDockerfileInstructions('RUN apt-get install -y curl && rm -rf /var/lib/apt/lists/*\n');
  assert.ok(!hasAptCacheNotCleaned(ins));
});

// ── hasAddInsteadOfCopy ───────────────────────────────────────────────────────

test('add: local ADD flagged', () => {
  const ins = parseDockerfileInstructions('ADD ./app /app\n');
  assert.ok(hasAddInsteadOfCopy(ins));
});
test('add: ADD with URL not flagged', () => {
  const ins = parseDockerfileInstructions('ADD https://example.com/file.tar.gz /tmp/\n');
  assert.ok(!hasAddInsteadOfCopy(ins));
});
test('add: COPY not flagged', () => {
  const ins = parseDockerfileInstructions('COPY ./app /app\n');
  assert.ok(!hasAddInsteadOfCopy(ins));
});

// ── hasSudoUsage ──────────────────────────────────────────────────────────────

test('sudo: sudo in RUN flagged', () => {
  const ins = parseDockerfileInstructions('RUN sudo apt-get install curl\n');
  assert.ok(hasSudoUsage(ins));
});
test('sudo: no sudo ok', () => {
  const ins = parseDockerfileInstructions('RUN apt-get install curl\n');
  assert.ok(!hasSudoUsage(ins));
});
test('sudo: pseudoword not flagged', () => {
  const ins = parseDockerfileInstructions('RUN echo pseudosomething\n');
  assert.ok(!hasSudoUsage(ins));
});

// ── hasRootUser ───────────────────────────────────────────────────────────────

test('root: no USER instruction = root', () => {
  const ins = parseDockerfileInstructions('FROM alpine\nRUN echo hi\n');
  assert.ok(hasRootUser(ins));
});
test('root: USER app = not root', () => {
  const ins = parseDockerfileInstructions('FROM alpine\nUSER app\n');
  assert.ok(!hasRootUser(ins));
});
test('root: USER root = root', () => {
  const ins = parseDockerfileInstructions('FROM alpine\nUSER root\n');
  assert.ok(hasRootUser(ins));
});
test('root: USER 0 = root', () => {
  const ins = parseDockerfileInstructions('FROM alpine\nUSER 0\n');
  assert.ok(hasRootUser(ins));
});
test('root: last USER wins', () => {
  const ins = parseDockerfileInstructions('FROM alpine\nUSER app\nUSER root\n');
  assert.ok(hasRootUser(ins));
});
test('root: USER nonroot ok', () => {
  const ins = parseDockerfileInstructions('FROM alpine\nUSER nonroot\n');
  assert.ok(!hasRootUser(ins));
});

// ── hasSensitiveEnvVar ────────────────────────────────────────────────────────

test('sensitive: ENV with password flagged', () => {
  const ins = parseDockerfileInstructions('ENV DB_PASSWORD=secret\n');
  assert.ok(hasSensitiveEnvVar(ins));
});
test('sensitive: ENV with SECRET flagged', () => {
  const ins = parseDockerfileInstructions('ENV API_SECRET=abc\n');
  assert.ok(hasSensitiveEnvVar(ins));
});
test('sensitive: ENV with TOKEN flagged', () => {
  const ins = parseDockerfileInstructions('ENV AUTH_TOKEN=xyz\n');
  assert.ok(hasSensitiveEnvVar(ins));
});
test('sensitive: ENV with API_KEY flagged', () => {
  const ins = parseDockerfileInstructions('ENV MY_API_KEY=value\n');
  assert.ok(hasSensitiveEnvVar(ins));
});
test('sensitive: normal ENV ok', () => {
  const ins = parseDockerfileInstructions('ENV NODE_ENV=production\n');
  assert.ok(!hasSensitiveEnvVar(ins));
});
test('sensitive: ENV PORT not sensitive', () => {
  const ins = parseDockerfileInstructions('ENV PORT=3000\n');
  assert.ok(!hasSensitiveEnvVar(ins));
});

// ── countLayers ───────────────────────────────────────────────────────────────

test('layers: RUN counts as layer', () => {
  const ins = parseDockerfileInstructions('RUN npm install\n');
  assert.equal(countLayers(ins), 1);
});
test('layers: COPY counts as layer', () => {
  const ins = parseDockerfileInstructions('COPY . .\n');
  assert.equal(countLayers(ins), 1);
});
test('layers: ADD counts as layer', () => {
  const ins = parseDockerfileInstructions('ADD . .\n');
  assert.equal(countLayers(ins), 1);
});
test('layers: FROM does not count', () => {
  const ins = parseDockerfileInstructions('FROM alpine\n');
  assert.equal(countLayers(ins), 0);
});
test('layers: multiple layers counted', () => {
  const src = 'FROM node:20\nCOPY . .\nRUN npm install\nRUN npm test\n';
  const ins = parseDockerfileInstructions(src);
  assert.equal(countLayers(ins), 3);
});

// ── hasConsecutiveRunLayers ───────────────────────────────────────────────────

test('consecutive: two RUN in a row flagged', () => {
  const ins = parseDockerfileInstructions('FROM alpine\nRUN cmd1\nRUN cmd2\n');
  assert.ok(hasConsecutiveRunLayers(ins));
});
test('consecutive: RUN COPY RUN not flagged', () => {
  const ins = parseDockerfileInstructions('FROM alpine\nRUN cmd1\nCOPY . .\nRUN cmd2\n');
  assert.ok(!hasConsecutiveRunLayers(ins));
});
test('consecutive: single RUN not flagged', () => {
  const ins = parseDockerfileInstructions('FROM alpine\nRUN cmd1\n');
  assert.ok(!hasConsecutiveRunLayers(ins));
});

// ── analyzeDockerfile integration ────────────────────────────────────────────

test('analyze: empty returns error', () => {
  const r = analyzeDockerfile('');
  assert.ok(r.errors.some(e => e.msg.includes('Empty')));
});
test('analyze: missing FROM error', () => {
  const r = analyzeDockerfile('RUN echo hello\n');
  assert.ok(r.errors.some(e => e.msg.includes('FROM')));
});
test('analyze: good dockerfile no errors', () => {
  const src = 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nUSER node\n';
  const r = analyzeDockerfile(src);
  assert.equal(r.errors.length, 0);
});
test('analyze: latest tag warning', () => {
  const src = 'FROM node:latest\nWORKDIR /app\nUSER node\n';
  const r = analyzeDockerfile(src);
  assert.ok(r.warnings.some(w => w.msg.includes('latest')));
});
test('analyze: sudo error', () => {
  const src = 'FROM alpine\nRUN sudo chmod +x /app\n';
  const r = analyzeDockerfile(src);
  assert.ok(r.errors.some(e => e.msg.includes('sudo')));
});
test('analyze: sensitive env error', () => {
  const src = 'FROM alpine\nENV DB_PASSWORD=secret\n';
  const r = analyzeDockerfile(src);
  assert.ok(r.errors.some(e => e.msg.includes('Sensitive')));
});
test('analyze: no WORKDIR warning', () => {
  const src = 'FROM alpine\nRUN echo hi\nUSER app\n';
  const r = analyzeDockerfile(src);
  assert.ok(r.warnings.some(w => w.msg.includes('WORKDIR')));
});
test('analyze: layer count in info', () => {
  const src = 'FROM node:20\nWORKDIR /app\nCOPY . .\nRUN npm install\nUSER node\n';
  const r = analyzeDockerfile(src);
  assert.ok(r.info.some(i => i.msg.includes('layers')));
});
test('analyze: multi-stage noted in info', () => {
  const src = 'FROM node:20 AS build\nRUN npm run build\nFROM node:20-alpine\nWORKDIR /app\nCOPY --from=build /app/dist .\nUSER node\n';
  const r = analyzeDockerfile(src);
  assert.ok(r.info.some(i => i.msg.includes('Multi-stage') || i.msg.includes('multi-stage')));
});
test('analyze: healthcheck noted in info', () => {
  const src = 'FROM alpine\nWORKDIR /app\nHEALTHCHECK CMD curl -f http://localhost/health\nUSER app\n';
  const r = analyzeDockerfile(src);
  assert.ok(r.info.some(i => i.msg.includes('HEALTHCHECK')));
});
test('analyze: root user warning', () => {
  const src = 'FROM alpine\nWORKDIR /app\nRUN echo hi\n';
  const r = analyzeDockerfile(src);
  assert.ok(r.warnings.some(w => w.msg.includes('root')));
});
test('analyze: errors is array', () => {
  const r = analyzeDockerfile('FROM alpine\nWORKDIR /app\nUSER app\n');
  assert.ok(Array.isArray(r.errors));
});
test('analyze: warnings is array', () => {
  const r = analyzeDockerfile('FROM alpine\nWORKDIR /app\nUSER app\n');
  assert.ok(Array.isArray(r.warnings));
});
test('analyze: whitespace only is empty error', () => {
  const r = analyzeDockerfile('   \n\t  ');
  assert.ok(r.errors.some(e => e.msg.includes('Empty')));
});
test('analyze: apt update without install warning', () => {
  const src = 'FROM ubuntu\nWORKDIR /app\nRUN apt-get update\nUSER app\n';
  const r = analyzeDockerfile(src);
  assert.ok(r.warnings.some(w => w.msg.includes('apt-get update')));
});
test('analyze: ADD local file warning', () => {
  const src = 'FROM alpine\nWORKDIR /app\nADD ./app /app\nUSER app\n';
  const r = analyzeDockerfile(src);
  assert.ok(r.warnings.some(w => w.msg.includes('ADD') || w.msg.includes('COPY')));
});
test('parse: ENTRYPOINT instruction', () => {
  const ins = parseDockerfileInstructions('ENTRYPOINT ["/bin/sh"]\n');
  assert.equal(ins[0].instruction, 'ENTRYPOINT');
});
test('parse: ARG instruction', () => {
  const ins = parseDockerfileInstructions('ARG BUILD_VERSION=1.0\n');
  assert.equal(ins[0].instruction, 'ARG');
  assert.ok(ins[0].value.includes('BUILD_VERSION'));
});
test('layers: WORKDIR not a layer', () => {
  const ins = parseDockerfileInstructions('WORKDIR /app\n');
  assert.equal(countLayers(ins), 0);
});

console.log(`\nAll ${passed} tests passed.`);
