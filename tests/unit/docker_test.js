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
  // The sandbox is gated by HTTP Basic Auth at the edge; the in-app Polar overlay
  // (#76) is retired (POLAR.enabled=false). /tools/* stays open for shareable demos.
  assert(cf.includes('basic_auth'), 'sandbox must be gated by edge basic_auth');
  assert(cf.includes('not path /tools/*'), 'sandbox /tools/* must stay open (shareable demos)');
});

Deno.test('docker-compose.yml isolates the sandbox web service', async () => {
  const dc = await read('docker-compose.yml');
  assert(dc.includes('web-sandbox:'), 'web-sandbox service missing');
});

Deno.test('browser e2e image runs Chromium (playwright) against the web service', async () => {
  const df = await read('tests/browser/Dockerfile');
  assert(df.includes('playwright'), 'playwright base image expected');
  const spec = await read('tests/browser/streetview.e2e.mjs');
  assert(spec.includes('chromium.launch'), 'must launch chromium');
  assert(spec.includes("TARGET_URL || 'http://web/'"), 'must default to compose web service');
});
