// 聽&說 shares the Upstash Redis store with VerseRain. Every key the api/
// functions touch goes through this wrapper, which prepends a namespace so
// leaderboards, the player map, and gamification data stay separate.
const PREFIX = 'ls:';

function wrap(target) {
  return new Proxy(target, {
    get(obj, prop) {
      const v = obj[prop];
      if (typeof v !== 'function') return v;
      if (prop === 'pipeline' || prop === 'multi') {
        return (...args) => wrap(v.apply(obj, args));
      }
      if (prop === 'exec') return (...args) => v.apply(obj, args);
      return (...args) => {
        if (typeof args[0] === 'string') args[0] = PREFIX + args[0];
        const out = v.apply(obj, args);
        // pipeline commands return the pipeline itself for chaining
        return out === obj ? wrap(obj) : out;
      };
    }
  });
}

export function prefixedRedis(redis) { return wrap(redis); }
