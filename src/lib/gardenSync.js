// Pure, testable garden-sync logic shared by App.jsx.
//
// SAFETY INVARIANT: never overwrite the cloud copy with a local-only snapshot.
// If we cannot positively confirm what the cloud currently holds, a local-only
// fallback is used WITHOUT writing back to the server. This is what prevents the
// "回到上周 / 昨天的更新没了" data-loss class of bug.

// Field-level merge: keep the higher stage/fruits per verse, and union the
// _activity map keeping the max activity value per day. Monotonic — never drops.
export function mergeGardens(remoteGd, localGd) {
  remoteGd = remoteGd || {};
  localGd = localGd || {};
  const merged = { ...remoteGd };
  Object.entries(localGd).forEach(([ref, localEntry]) => {
    if (ref === '_activity') return; // handled separately below
    if (!localEntry || typeof localEntry !== 'object') return;
    if (!merged[ref]) {
      merged[ref] = localEntry;
    } else {
      merged[ref] = {
        ...merged[ref],
        stage: Math.max(merged[ref].stage || 0, localEntry.stage || 0),
        fruits: Math.max(merged[ref].fruits || 0, localEntry.fruits || 0),
      };
    }
  });
  const remoteAct = (remoteGd && remoteGd._activity) || {};
  const localAct = (localGd && localGd._activity) || {};
  const mergedAct = { ...remoteAct };
  Object.entries(localAct).forEach(([day, val]) => {
    mergedAct[day] = Math.max(mergedAct[day] || 0, val || 0);
  });
  merged._activity = mergedAct;
  return merged;
}

// Stamp today's login activity (>= 100) without lowering an existing value.
export function stampTodayLogin(gd, todayStr) {
  const day = todayStr || new Date().toLocaleDateString('en-CA');
  const out = { ...(gd || {}) };
  out._activity = { ...(out._activity || {}) };
  if ((out._activity[day] || 0) < 100) out._activity[day] = 100;
  return out;
}

// Classify a fetch Response into one of three trust levels.
//   ok       -> 200, remote data is trustworthy (safe to merge + push)
//   empty    -> 404, brand-new player (safe to push local up)
//   unknown  -> any other status (DO NOT push local up — could clobber remote)
export async function classifyGardenResponse(r) {
  if (r && r.ok) {
    const data = await r.json().catch(() => null);
    const remoteGd = (data && data.gardenData && typeof data.gardenData === 'object') ? data.gardenData : {};
    return { kind: 'ok', remoteGd };
  }
  if (r && r.status === 404) return { kind: 'empty' };
  return { kind: 'unknown' };
}

// Given the classification + local garden, decide the next state.
// Returns { garden, shouldPushToCloud }.
//   - unknown  -> local-only, shouldPushToCloud = false  (the critical fix)
//   - ok/empty -> merged,     shouldPushToCloud = true
export function decideGardenSync(classification, localGd, todayStr) {
  if (!classification || classification.kind === 'unknown') {
    return { garden: stampTodayLogin(localGd, todayStr), shouldPushToCloud: false };
  }
  const remoteGd = classification.kind === 'ok' ? classification.remoteGd : {};
  const merged = stampTodayLogin(mergeGardens(remoteGd, localGd), todayStr);
  return { garden: merged, shouldPushToCloud: true };
}

// Build the deduped list of point-bucket keys to query for a logged-in user:
// playerName (authoring) + current personalCode (referrals) + any previous
// codes this device used before adopting the account's canonical code. Including
// old codes ensures historic referral fruits aren't lost after code unification.
export function buildFruitAuthorKeys(playerName, personalCode, prevCodes) {
  const list = [playerName, personalCode, ...(Array.isArray(prevCodes) ? prevCodes : [])];
  return Array.from(new Set(list.filter((k) => k && typeof k === 'string')));
}

// Sum points across the per-key API responses (dedup already handled by keys).
export function aggregateFruitResults(results) {
  let creator = 0, referral = 0, creatorHist = [], refHist = [];
  for (const d of results || []) {
    if (!d) continue;
    creator += (d.points || 0);
    referral += (d.referralPoints || 0);
    creatorHist = creatorHist.concat(d.creatorHistory || []);
    refHist = refHist.concat(d.referralHistory || []);
  }
  creatorHist.sort((a, b) => b.timestamp - a.timestamp);
  refHist.sort((a, b) => b.timestamp - a.timestamp);
  return { creator, referral, total: creator + referral, creatorHist, refHist };
}
