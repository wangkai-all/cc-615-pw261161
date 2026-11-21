import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, hashSeed } from '../src/rng.js';

test('相同种子的 PRNG 产出完全相同的序列', () => {
  const a = makeRng('abc');
  const b = makeRng('abc');
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test('不同种子产出不同序列', () => {
  const a = makeRng('seed-a');
  const b = makeRng('seed-b');
  assert.notEqual(a.next(), b.next());
});

test('hashSeed 对相同字符串稳定且为无符号整数', () => {
  const h1 = hashSeed('registry-2026w47');
  const h2 = hashSeed('registry-2026w47');
  assert.equal(h1, h2);
  assert.ok(Number.isInteger(h1) && h1 >= 0 && h1 <= 0xffffffff);
});

test('shuffle 不修改原数组且保持元素集合不变', () => {
  const rng = makeRng(7);
  const original = [1, 2, 3, 4, 5, 6];
  const shuffled = rng.shuffle(original);
  assert.deepEqual(original, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(shuffled.sort(), [1, 2, 3, 4, 5, 6]);
});

test('int 与 pick 始终落在合法范围内', () => {
  const rng = makeRng(99);
  for (let i = 0; i < 100; i++) {
    const x = rng.int(4);
    assert.ok(x >= 0 && x < 4);
    assert.ok(['a', 'b', 'c'].includes(rng.pick(['a', 'b', 'c'])));
  }
});
