#!/usr/bin/env node
// Repair the verse references on the PartyKit-published Hebrew verse sets.
//
// WHY
// The Hebrew sets were produced by translating the English ones, and the
// translator rendered the chapter as a Hebrew letter numeral — sometimes
// wrongly. Confirmed cases are a נ→ל substitution, i.e. 50 written as 30:
//   "ישעיהו ל״ה 10-11"  should be Isaiah 55:10-11   (ל=30, needs נ=50)
//   "ישעיהו ל״ח:11"     should be Isaiah 58:11
// Book names drifted too ("ג'יימס" = a phonetic "James" instead of יעקב,
// "סימן" = the word "sign" instead of מרקוס for Mark).
//
// A wrong reference is worse than an ugly one: the bilingual secondary looks
// the reference up, so the reader is shown a DIFFERENT verse beside the Hebrew.
//
// WHAT IT DOES
// For each published Hebrew set it finds the English twin (same base id), takes
// the reference at the same index as ground truth, and rewrites the Hebrew
// reference as "<Hebrew book name> <chapter>:<verses>" using ASCII digits.
// ASCII digits are deliberate: they cannot be mis-transcribed, and they already
// normalize through the oldest, most-exercised code path.
//
// SAFETY
//   * Only sets whose twin has the SAME verse count are touched — index
//     alignment is the whole basis of the derivation.
//   * Only the `reference` field is rewritten. Verse text is never touched.
//   * Dry run by default; --publish is required to write anything.
//
// Usage:
//   node scripts/fix-hebrew-references.mjs            # dry run, prints a diff
//   node scripts/fix-hebrew-references.mjs --publish  # POST the updated sets

const HOST = 'https://verserain-party.hungry4grace.partykit.dev/parties/main/global-auth-db';
const PUBLISH = process.argv.includes('--publish');
const ADMIN_EMAIL = process.env.VERSERAIN_ADMIN_EMAIL || '';

// id → canonical full Hebrew book name (the first spelling listed in
// HEBREW_FULL_BOOK_ID for that id, which is what the app already recognises).
const HEBREW_BOOK_BY_ID = {
  1:'בראשית',2:'שמות',3:'ויקרא',4:'במדבר',5:'דברים',6:'יהושע',7:'שופטים',8:'רות',
  9:'שמואל א',10:'שמואל ב',11:'מלכים א',12:'מלכים ב',13:'דברי הימים א',14:'דברי הימים ב',
  15:'עזרא',16:'נחמיה',17:'אסתר',18:'איוב',19:'תהילים',20:'משלי',21:'קהלת',22:'שיר השירים',
  23:'ישעיהו',24:'ירמיהו',25:'איכה',26:'יחזקאל',27:'דניאל',28:'הושע',29:'יואל',30:'עמוס',
  31:'עובדיה',32:'יונה',33:'מיכה',34:'נחום',35:'חבקוק',36:'צפניה',37:'חגי',38:'זכריה',39:'מלאכי',
  40:'מתי',41:'מרקוס',42:'לוקס',43:'יוחנן',44:'מעשי השליחים',45:'רומים',
  46:'קורינתים א',47:'קורינתים ב',48:'גלטים',49:'אפסים',50:'פיליפים',51:'קולסים',
  52:'תסלוניקים א',53:'תסלוניקים ב',54:'טימותיאוס א',55:'טימותיאוס ב',56:'טיטוס',
  57:'פילמון',58:'עברים',59:'יעקב',60:'פטרוס א',61:'פטרוס ב',
  62:'יוחנן א',63:'יוחנן ב',64:'יוחנן ג',65:'יהודה',66:'חזון יוחנן',
};

// English book name / abbreviation → id.
const ENGLISH_BOOK_BY_NAME = new Map();
[
  [1,'genesis','gen'],[2,'exodus','exo','ex'],[3,'leviticus','lev'],[4,'numbers','num'],[5,'deuteronomy','deut','deu'],
  [6,'joshua','josh'],[7,'judges','judg'],[8,'ruth'],[9,'1 samuel','1samuel','1sam','1sa'],[10,'2 samuel','2samuel','2sam','2sa'],
  [11,'1 kings','1kings','1kgs','1ki'],[12,'2 kings','2kings','2kgs','2ki'],
  [13,'1 chronicles','1chronicles','1chr'],[14,'2 chronicles','2chronicles','2chr'],
  [15,'ezra'],[16,'nehemiah','neh'],[17,'esther','est'],[18,'job'],[19,'psalm','psalms','ps','psa'],
  [20,'proverbs','prov','pro'],[21,'ecclesiastes','eccl','ecc'],[22,'song of solomon','song of songs','song'],
  [23,'isaiah','isa'],[24,'jeremiah','jer'],[25,'lamentations','lam'],[26,'ezekiel','ezek','eze'],[27,'daniel','dan'],
  [28,'hosea','hos'],[29,'joel'],[30,'amos'],[31,'obadiah','obad'],[32,'jonah'],[33,'micah','mic'],[34,'nahum','nah'],
  [35,'habakkuk','hab'],[36,'zephaniah','zeph'],[37,'haggai','hag'],[38,'zechariah','zech'],[39,'malachi','mal'],
  [40,'matthew','matt','mat'],[41,'mark'],[42,'luke'],[43,'john'],[44,'acts'],[45,'romans','rom'],
  [46,'1 corinthians','1corinthians','1cor'],[47,'2 corinthians','2corinthians','2cor'],
  [48,'galatians','gal'],[49,'ephesians','eph'],[50,'philippians','phil','php'],[51,'colossians','col'],
  [52,'1 thessalonians','1thessalonians','1thess'],[53,'2 thessalonians','2thessalonians','2thess'],
  [54,'1 timothy','1timothy','1tim'],[55,'2 timothy','2timothy','2tim'],[56,'titus'],[57,'philemon','phlm'],
  [58,'hebrews','heb'],[59,'james','jas'],[60,'1 peter','1peter','1pet'],[61,'2 peter','2peter','2pet'],
  [62,'1 john','1john','1jn'],[63,'2 john','2john','2jn'],[64,'3 john','3john','3jn'],
  [65,'jude'],[66,'revelation','rev'],
].forEach(([id, ...names]) => names.forEach(n => ENGLISH_BOOK_BY_NAME.set(n, id)));

// "Isaiah 58:11" / "1 Corinthians 13:4-7" / "Psalm 23" → { id, chapter, verses }
function parseEnglishReference(ref) {
  const value = String(ref || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const m = /^((?:[1-3]\s*)?[A-Za-z][A-Za-z ]*?)\s+(\d+)(?::\s*([\d,\-\s]+))?$/.exec(value);
  if (!m) return null;
  const key = m[1].toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const id = ENGLISH_BOOK_BY_NAME.get(key) ?? ENGLISH_BOOK_BY_NAME.get(key.replace(/\s+/g, ''));
  if (!id) return null;
  return { id, chapter: Number(m[2]), verses: m[3] ? m[3].replace(/\s+/g, '') : null };
}

function hebrewReferenceFrom(parsed) {
  const book = HEBREW_BOOK_BY_ID[parsed.id];
  if (!book) return null;
  return parsed.verses ? `${book} ${parsed.chapter}:${parsed.verses}` : `${book} ${parsed.chapter}`;
}

const res = await fetch(`${HOST}/custom-sets`);
const allSets = await res.json();
const hebrewSets = allSets.filter(s => (s.language || '') === 'he');

let totalChanged = 0;
let totalSkipped = 0;
const updates = [];

for (const set of hebrewSets) {
  const base = set.id.replace(/-he$/, '');
  const twin = allSets.find(t =>
    t.id !== set.id &&
    (t.id === base || t.id.startsWith(`${base}-`)) &&
    ['kjv', 'esv', 'niv'].includes(t.language || '') &&
    (t.verses || []).length === (set.verses || []).length
  );

  if (!twin) {
    console.log(`SKIP SET  ${set.id} — no English twin with a matching verse count`);
    totalSkipped += (set.verses || []).length;
    continue;
  }

  const changes = [];
  const verses = set.verses.map((v, i) => {
    const parsed = parseEnglishReference(twin.verses[i]?.reference);
    const derived = parsed && hebrewReferenceFrom(parsed);
    if (!derived) {
      changes.push({ kind: 'unparsed', i, from: v.reference, twin: twin.verses[i]?.reference });
      return v;
    }
    if (derived !== v.reference) changes.push({ kind: 'fix', i, from: v.reference, to: derived, twin: twin.verses[i].reference });
    return { ...v, reference: derived };
  });

  const fixes = changes.filter(c => c.kind === 'fix');
  const unparsed = changes.filter(c => c.kind === 'unparsed');
  console.log(`\n=== ${set.id}  (twin: ${twin.id}, ${set.verses.length} verses) ===`);
  if (!fixes.length && !unparsed.length) console.log('  already correct');
  for (const c of fixes) console.log(`  [${String(c.i).padStart(2)}] ${c.from}  →  ${c.to}      (en: ${c.twin})`);
  for (const c of unparsed) console.log(`  [${String(c.i).padStart(2)}] KEPT — could not parse twin "${c.twin}"`);

  totalChanged += fixes.length;
  totalSkipped += unparsed.length;
  if (fixes.length) updates.push({ ...set, verses });
}

console.log(`\n────────────────────────────────────────`);
console.log(`references to fix : ${totalChanged}`);
console.log(`left untouched    : ${totalSkipped}`);
console.log(`sets to republish : ${updates.length}`);

if (!PUBLISH) {
  console.log('\nDry run. Re-run with --publish to write these back.');
  process.exit(0);
}

if (!ADMIN_EMAIL) {
  console.error('\nVERSERAIN_ADMIN_EMAIL is required to publish.');
  process.exit(1);
}

for (const set of updates) {
  const r = await fetch(`${HOST}/custom-sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...set, adminEmail: ADMIN_EMAIL, email: ADMIN_EMAIL }),
  });
  console.log(`${r.ok ? 'PUBLISHED' : 'FAILED   '}  ${set.id}  (HTTP ${r.status})`);
  await new Promise(res2 => setTimeout(res2, 400));
}
