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
  // Public exposure: a Caddy edge owns 127.0.0.1:8087 (the platform proxy target)
  assert(dc.includes('edge:'), 'edge service missing');
  assert(dc.includes('caddy'), 'edge must run Caddy');
  assert(dc.includes('127.0.0.1:${WEB_PORT:-8087}:80'), 'edge must bind 127.0.0.1:8087 for the platform reverse-proxy');
  assert(dc.includes('docker/Caddyfile'), 'edge must mount the mapmax Caddyfile');
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
