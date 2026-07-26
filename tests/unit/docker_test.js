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

Deno.test('docker-compose.yml defines web + containerized-Chromium e2e services', async () => {
  const dc = await read('docker-compose.yml');
  assert(dc.includes('services:'), 'services missing');
  assert(dc.includes('web:'), 'web service missing');
  assert(dc.includes('e2e:'), 'e2e service missing');
  assert(dc.includes('build: tests/browser'), 'e2e must build the Chromium test image');
  assert(dc.includes('TARGET_URL'), 'e2e must accept TARGET_URL override');
});

Deno.test('browser e2e image runs Chromium (playwright) against the web service', async () => {
  const df = await read('tests/browser/Dockerfile');
  assert(df.includes('playwright'), 'playwright base image expected');
  const spec = await read('tests/browser/streetview.e2e.mjs');
  assert(spec.includes('chromium.launch'), 'must launch chromium');
  assert(spec.includes("TARGET_URL || 'http://web/'"), 'must default to compose web service');
});
