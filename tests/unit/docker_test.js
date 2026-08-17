// Deployment-policy tests (issue #15): compose + Dockerfile based build/run.
import { assert } from 'jsr:@std/assert@1';

const read = (p) => Deno.readTextFile(new URL(`../../${p}`, import.meta.url));

Deno.test('Dockerfile builds a static server image with the app files', async () => {
  const df = await read('Dockerfile');
  assert(df.startsWith('#') || df.startsWith('FROM'), 'must be a Dockerfile');
  assert(df.includes('FROM '), 'FROM missing');
  assert(df.includes('nginx'), 'static server base image expected');
  for (const artifact of ['index.html', 'styles.css', 'src/', 'assets/']) {
    assert(df.includes(artifact), `${artifact} not copied into image`);
  }
});

Deno.test('docker-compose.yml defines edge + web + containerized-Chromium e2e services', async () => {
  const dc = await read('docker-compose.yml');
  assert(dc.includes('services:'), 'services missing');
  assert(dc.includes('web:'), 'web service missing');
  assert(dc.includes('e2e:'), 'e2e service missing');
  assert(dc.includes('build: tests/browser'), 'e2e must build the Chromium test image');
  assert(dc.includes('TARGET_URL'), 'e2e must accept TARGET_URL override');
  // Public exposure: a Caddy edge owns the 1PESI band port (mapmax = 14000,
  // migration complete — the legacy 8087 publish is gone).
  assert(dc.includes('edge:'), 'edge service missing');
  assert(dc.includes('caddy'), 'edge must run Caddy');
  assert(dc.includes('127.0.0.1:${WEB_PORT:-14000}:80'), 'edge must bind the 14xxx band port for the platform reverse-proxy');
  // 1PESI environment digits: PROD X000, STAGING X300, SANDBOX X400.
  assert(dc.includes('127.0.0.1:${STAGING_PORT:-14300}:14300'), 'staging must have its own edge listener on 14300');
  assert(dc.includes('127.0.0.1:${SANDBOX_PORT:-14400}:80'), 'sandbox must be published on 14400');
  // Platform RULES §6: a sandbox is NEVER proxied through the production edge.
  const edgeBlock = dc.slice(dc.indexOf('  edge:'), dc.indexOf('  edge-sandbox:'));
  assert(!edgeBlock.includes('14400'), 'the sandbox port must not be published by the production edge');
  assert(dc.includes('Caddyfile.sandbox'), 'the sandbox edge must use its own Caddyfile');
  // #146: the production edge must not DEPEND on the sandbox either, or its
  // systemd unit would start (and therefore bounce) the sandbox with it.
  const directives = (block) => block.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  const edgeDeps = directives(edgeBlock.slice(edgeBlock.indexOf('depends_on:')));
  assert(!edgeDeps.includes('web-sandbox'), 'the production edge must not depend on the sandbox service');
  assert(!dc.includes(':8087:80'), 'legacy 8087 must stay retired — no publish line (1PESI migration complete)');
  assert(dc.includes('docker/Caddyfile'), 'edge must mount the mapmax Caddyfile');
});

Deno.test('systemd units keep production and sandbox independently movable (#146)', async () => {
  const prod = await read('scripts/mapmax-stack.service');
  const sandbox = await read('scripts/mapmax-sandbox-stack.service');
  // Neither unit may `down` the project: that tears down the other side too.
  for (const [name, unit] of [['production', prod], ['sandbox', sandbox]]) {
    assert(!/podman-compose down/.test(unit), `${name} unit must not down the whole compose project (#146)`);
  }
  assert(/ExecStart=.*up .*edge web web-staging/.test(prod), 'production unit must own exactly edge/web/web-staging');
  assert(!/ExecStart=.*web-sandbox/.test(prod), 'production unit must not own the sandbox');
  assert(/ExecStart=.*up .*edge-sandbox web-sandbox/.test(sandbox), 'sandbox unit must own the sandbox services');
  // #154: the world-band api rides with the sandbox, never with production.
  assert(/ExecStart=.*\bapi\b/.test(sandbox), 'sandbox unit must own the api service (#154)');
  assert(!/ExecStart=.*\bapi\b/.test(prod), 'production unit must not own the api service (#154)');
});

Deno.test('world-band api is wired sandbox-only (#154)', async () => {
  const dc = await read('docker-compose.yml');
  assert(dc.includes('dockerfile: api/Dockerfile'), 'api service missing from compose');
  assert(dc.includes('worldband-cache:/var/cache/worldband'), 'api must persist its render cache');
  const cfSandbox = await read('docker/Caddyfile.sandbox');
  assert(cfSandbox.includes('handle /api/*') && cfSandbox.includes('reverse_proxy api:8080'), 'sandbox edge must route /api/* to the api service');
  const cfProd = await read('docker/Caddyfile');
  assert(!cfProd.includes('api:8080'), 'the production edge must NOT route to the api yet — the app falls back to the in-browser spin there');
});

Deno.test('docker/Caddyfile routes the confinia.io hosts to the web service', async () => {
  const cf = await read('docker/Caddyfile');
  for (const host of ['www.mapmax.confinia.io', 'sandbox.mapmax.confinia.io', 'staging.mapmax.confinia.io']) {
    assert(cf.includes(host), `${host} missing from Caddyfile`);
  }
  assert(cf.includes('reverse_proxy web:80'), 'must proxy to the web service');
  assert(cf.includes('auto_https off'), 'TLS is terminated by the platform proxy — edge must stay plain HTTP');
  // Sandbox isolation: its own service + an access gate at the edge
  assert(cf.includes('reverse_proxy web-sandbox:80'), 'sandbox must route to the isolated web-sandbox service');
  // The sandbox is OPEN (#92): no early edge gate — the priority is to let users
  // try. Usage limiting is a future SOFT in-app 360° counter, not edge basic-auth
  // or the retired Polar overlay (#76).
  assert(!cf.includes('basic_auth'), 'sandbox must be open — no edge basic_auth (#92)');
});

Deno.test('docker-compose.yml isolates the sandbox web service', async () => {
  const dc = await read('docker-compose.yml');
  assert(dc.includes('web-sandbox:'), 'web-sandbox service missing');
});

Deno.test('stack is split into prod / staging / sandbox, env baked per image (#95)', async () => {
  const dc = await read('docker-compose.yml');
  assert(dc.includes('web-staging:'), 'web-staging service missing');
  assert(/MAPMAX_ENV:\s*staging/.test(dc), 'web-staging must build with MAPMAX_ENV=staging');
  const cf = await read('docker/Caddyfile');
  assert(cf.includes('reverse_proxy web-staging:80'), 'staging host must route to web-staging');
  const df = await read('Dockerfile');
  assert(df.includes('MAPMAX_ENV'), 'base Dockerfile must bake MAPMAX_ENV into env.js');
});

Deno.test('browser e2e image runs Chromium (playwright) against the web service', async () => {
  const df = await read('tests/browser/Dockerfile');
  assert(df.includes('playwright'), 'playwright base image expected');
  const spec = await read('tests/browser/streetview.e2e.mjs');
  assert(spec.includes('chromium.launch'), 'must launch chromium');
  assert(spec.includes("TARGET_URL || 'http://web/'"), 'must default to compose web service');
});
