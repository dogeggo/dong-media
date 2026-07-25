import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeInlineJson } from './inline-json.ts';

test('inline JSON cannot terminate its script element', () => {
  const serialized = serializeInlineJson({
    name: '</script><img src=x onerror=alert(1)>',
  });
  assert.equal(serialized.includes('</script>'), false);
  assert.equal(serialized.includes('<img'), false);
  assert.deepEqual(JSON.parse(serialized), {
    name: '</script><img src=x onerror=alert(1)>',
  });
});
