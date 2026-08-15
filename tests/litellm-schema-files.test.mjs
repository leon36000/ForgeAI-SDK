import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const [path, version] of [
  ['schemas/advisory-request-v0.3.0-alpha.1.schema.json', 'forgeai.advisory-request.v0.3.0-alpha.1'],
  ['schemas/advisory-result-v0.3.0-alpha.1.schema.json', 'forgeai.advisory-result.v0.3.0-alpha.1'],
  ['schemas/litellm-router-policy-v0.3.0-alpha.1.schema.json', 'forgeai.litellm-router-policy.v0.3.0-alpha.1'],
]) {
  test(`${path} is strict and version-bound`, async () => {
    const schema = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.schema_version.const, version);
  });
}
