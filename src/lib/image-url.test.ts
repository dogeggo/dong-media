import assert from 'node:assert/strict';
import test from 'node:test';

import { processImageUrl } from './image-url.ts';

test('routes external HTTP images through the same-origin image proxy', () => {
  assert.equal(
    processImageUrl('https://images.example/poster.jpg?w=600'),
    '/api/image-proxy?url=https%3A%2F%2Fimages.example%2Fposter.jpg%3Fw%3D600',
  );
  assert.equal(
    processImageUrl('//images.example/poster.jpg'),
    '/api/image-proxy?url=https%3A%2F%2Fimages.example%2Fposter.jpg',
  );
  assert.equal(
    processImageUrl('https://images.example/poster.jpg?token=public-source'),
    '/api/image-proxy?url=https%3A%2F%2Fimages.example%2Fposter.jpg%3Ftoken%3Dpublic-source',
  );
});

test('leaves local and non-HTTP image sources untouched', () => {
  assert.equal(processImageUrl('/images/poster.jpg'), '/images/poster.jpg');
  assert.equal(
    processImageUrl('data:image/png;base64,AAAA'),
    'data:image/png;base64,AAAA',
  );
  assert.equal(processImageUrl('not a URL'), 'not a URL');
});
