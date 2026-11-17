import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const {CANARY_VARIANT: variant, CANARY_PHASE: phase} = process.env;
assert.ok(['builtin', 'profile', 'manual', 'hybrid'].includes(variant));
assert.ok(
  [
    'seed',
    'seed-consume',
    'enrich',
    'consume',
    'observe',
    'cold-ro',
    'cold-rw',
    'check-ro',
    'check-rw',
    'other-profile'
  ].includes(phase)
);
const lane = phase.endsWith('-ro')
  ? 'read-only'
  : phase.endsWith('-rw')
    ? 'writable'
    : 'lifecycle';
const workspace = process.env.GITHUB_WORKSPACE;
const temp = process.env.RUNNER_TEMP;
assert.ok(workspace && temp && process.env.GITHUB_RUN_ID);
assert.ok(process.env.GITHUB_RUN_ATTEMPT);
const repository = path.join(
  temp,
  'setup-java-composition',
  variant,
  lane,
  'repository'
);
const results = path.join(temp, 'composition-results', variant, phase);
const profile = phase === 'other-profile' ? 'other' : 'full';
const revision = ['enrich', 'consume', 'observe', 'other-profile'].includes(
  phase
)
  ? 'H2'
  : 'H1';
const fixture = path.join(workspace, '.cache-composition');
const output = (key, value) =>
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);

if (process.argv[2] === 'prepare') {
  // Every phase starts empty; only a cache restore can supply a sentinel.
  fs.rmSync(repository, {recursive: true, force: true});
  fs.mkdirSync(repository, {recursive: true});
  fs.mkdirSync(results, {recursive: true});
  fs.mkdirSync(fixture, {recursive: true});
  fs.writeFileSync(
    path.join(fixture, 'pom.xml'),
    `<project><modelVersion>4.0.0</modelVersion><groupId>cache.canary</groupId><artifactId>sentinel</artifactId><version>${revision}</version></project>\n`
  );
  const identity = [
    process.env.GITHUB_RUN_ID,
    process.env.GITHUB_RUN_ATTEMPT,
    variant,
    lane
  ].join('-');
  fs.writeFileSync(path.join(fixture, 'run'), identity);
  fs.writeFileSync(path.join(fixture, 'profile'), profile);
  output('repository', repository);
  output('results', results);
  output(
    'prefix',
    `setup-java-composition-v1-${process.env.RUNNER_OS}-${process.arch}-${identity}-${profile}-`
  );
  output('read-only', !['seed', 'enrich', 'cold-rw'].includes(phase));
  output('started', Date.now());
  if (variant === 'hybrid' && phase === 'enrich') {
    const predecessor = fs
      .readFileSync(
        path.join(temp, 'composition-predecessor', 'primary-key.txt'),
        'utf8'
      )
      .trim();
    assert.match(predecessor, /^setup-java-Linux-[a-z0-9]+-maven-[a-f0-9]+$/);
    output('predecessor', predecessor);
  }
} else if (process.argv[2] === 'verify') {
  const primary = process.env.CANARY_PRIMARY;
  const hit = process.env.CANARY_HIT;
  const matched = process.env.CANARY_MATCHED || '';
  assert.ok(
    primary,
    'Primary key must be populated; a skipped restore is not a miss'
  );
  const has = name => fs.existsSync(path.join(repository, name));
  const write = name => fs.writeFileSync(path.join(repository, name), name);
  const exact = ['seed-consume', 'consume', 'observe', 'check-rw'].includes(
    phase
  );
  assert.equal(
    hit === 'true',
    exact,
    `${variant}/${phase}: unexpected exact-hit output`
  );
  if (exact) {
    assert.ok(
      has(phase === 'seed-consume' ? 'seed' : 'enriched'),
      'Exact hit must restore the saved payload'
    );
    if (variant === 'manual') assert.equal(matched, primary);
  } else if (phase === 'enrich' && ['manual', 'hybrid'].includes(variant)) {
    assert.ok(
      has('seed'),
      'Warm restore must contain the predecessor sentinel'
    );
    assert.ok(matched, 'Warm restore must report its matched key');
    assert.notEqual(
      matched,
      primary,
      'Enrichment must save under the NEW primary'
    );
    if (variant === 'hybrid') {
      assert.equal(matched, process.env.CANARY_PREDECESSOR);
    }
  } else {
    assert.equal(matched, '', 'Cold restore must not match another key');
    assert.equal(has('seed'), false, 'Cold restore must start empty');
    assert.equal(has('enriched'), false);
  }
  if (phase === 'observe') {
    assert.equal(
      has('consumer-only'),
      false,
      'An exact-hit mutation must not persist'
    );
  }
  if (phase === 'consume') write('consumer-only');
  if (phase === 'seed') write('seed');
  if (['enrich', 'cold-ro', 'cold-rw'].includes(phase)) write('enriched');

  const report = {
    variant,
    phase,
    lane,
    profile,
    revision,
    repository,
    primary,
    matched,
    exactHit: exact,
    setupHit: process.env.CANARY_SETUP_HIT || null,
    restoreAndSetupMilliseconds:
      Date.now() - Number(process.env.CANARY_STARTED),
    saveOwner:
      variant === 'manual' ? 'actions/cache/save' : 'setup-java post action',
    postSaveVerified: false,
    measurement:
      'Sentinel lifecycle only; not a Maven transfer or archive-size benchmark'
  };
  fs.writeFileSync(
    path.join(results, 'report.json'),
    JSON.stringify(report, null, 2)
  );
  fs.writeFileSync(path.join(results, 'primary-key.txt'), primary);
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### ${variant} / ${phase}\n\nSentinel assertions passed. Exact hit: ${exact}. ` +
      `Save owner: ${report.saveOwner}. Persistence is checked by the next job, not this pre-post report.\n\n`
  );
} else {
  throw new Error('Expected prepare or verify');
}
