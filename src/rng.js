// 可重复随机数：mulberry32（确定性 PRNG）+ 字符串种子哈希。
// 所有演示数据都来自显式种子，保证同一参数可重复生成同一批虚构记录。

export function hashSeed(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < String(str).length; i++) {
    h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const numericSeed = typeof seed === 'number' ? seed : hashSeed(String(seed));
  const next = mulberry32(numericSeed);
  return {
    seed: numericSeed,
    next,
    int(maxExclusive) {
      return Math.floor(next() * maxExclusive);
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    // Fisher–Yates，返回新数组，不改原数组
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}
