// 《道德經》 content pack for 聽&說 — sentence-by-sentence Chinese/English.
//
// Chinese: the received (王弼) text, punctuated as on ctext.org so that every
// item is one sentence ending in 。. English: James Legge, Tâo Teh King
// (Sacred Books of the East vol. 39, 1891, public domain), with "Tao" written
// "Dao" as ctext.org prints it. Each English entry is the part of Legge's
// rendering that corresponds to that one Chinese sentence.
//
// Chapters 1–3 for now; append more chapters to CHAPTERS in the same shape.
// Each chapter is ONE item; the sentence pairs are kept for line-by-line display.

const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const chapterName = (n) => `第${n <= 10 ? CN_NUM[n] : n}章`;

// [zh, en] pairs per chapter.
const CHAPTERS = [
  [
    ['道可道，非常道。', 'The Dao that can be trodden is not the enduring and unchanging Dao.'],
    ['名可名，非常名。', 'The name that can be named is not the enduring and unchanging name.'],
    ['無名天地之始；有名萬物之母。', '(Conceived of as) having no name, it is the Originator of heaven and earth; (conceived of as) having a name, it is the Mother of all things.'],
    ['故常無欲，以觀其妙；常有欲，以觀其徼。', 'Always without desire we must be found, if its deep mystery we would sound; but if desire always within us be, its outer fringe is all that we shall see.'],
    ['此兩者，同出而異名，同謂之玄。', 'Under these two aspects, it is really the same; but as development takes place, it receives the different names. Together we call them the Mystery.'],
    ['玄之又玄，衆妙之門。', 'Where the Mystery is the deepest is the gate of all that is subtle and wonderful.'],
  ],
  [
    ['天下皆知美之為美，斯惡已。', 'All in the world know the beauty of the beautiful, and in doing this they have (the idea of) what ugliness is;'],
    ['皆知善之為善，斯不善已。', 'they all know the skill of the skilful, and in doing this they have (the idea of) what the want of skill is.'],
    ['故有無相生，難易相成，長短相較，高下相傾，音聲相和，前後相隨。', 'So it is that existence and non-existence give birth the one to (the idea of) the other; that difficulty and ease produce the one (the idea of) the other; that length and shortness fashion out the one the figure of the other; that (the ideas of) height and lowness arise from the contrast of the one with the other; that the musical notes and tones become harmonious through the relation of one with another; and that being before and behind give the idea of one following another.'],
    ['是以聖人處無為之事，行不言之教；萬物作焉而不辭，生而不有，為而不恃，功成而弗居。', 'Therefore the sage manages affairs without doing anything, and conveys his instructions without the use of speech. All things spring up, and there is not one which declines to show itself; they grow, and there is no claim made for their ownership; they go through their processes, and there is no expectation (of a reward for the results). The work is accomplished, and there is no resting in it (as an achievement).'],
    ['夫唯弗居，是以不去。', "The work is done, but how no one can see; 'tis this that makes the power not cease to be."],
  ],
  [
    ['不尚賢，使民不爭；不貴難得之貨，使民不為盜；不見可欲，使心不亂。', 'Not to value and employ men of superior ability is the way to keep the people from rivalry among themselves; not to prize articles which are difficult to procure is the way to keep them from becoming thieves; not to show them what is likely to excite their desires is the way to keep their minds from disorder.'],
    ['是以聖人之治，虛其心，實其腹，弱其志，強其骨。', 'Therefore the sage, in the exercise of his government, empties their minds, fills their bellies, weakens their wills, and strengthens their bones.'],
    ['常使民無知無欲。', 'He constantly (tries to) keep them without knowledge and without desire,'],
    ['使夫知者不敢為也。', 'and where there are those who have knowledge, to keep them from presuming to act (on it).'],
    ['為無為，則無不治。', 'When there is this abstinence from action, good order is universal.'],
  ],
];

// One item per chapter. The Chinese sentences and their English renderings
// are joined line by line, so line N of the English is line N of the Chinese.
const verses = CHAPTERS.map((sentences, ci) => ({
  reference: chapterName(ci + 1),
  text: sentences.map(([zh]) => zh).join('\n'),
  textEn: sentences.map(([, en]) => en).join('\n'),
  chapter: ci + 1,
}));

export const DAODEJING_SETS = [
  {
    id: 'daodejing',
    title: '道德經 · 老子',
    titleEn: 'Dao De Jing · Laozi',
    description: `《道德經》王弼本，一章一段，中文逐句對照理雅各（James Legge，1891）英譯。目前收錄第一至第${CN_NUM[CHAPTERS.length]}章。`,
    language: 'cuv',
    sourceLang: 'zh',
    builtIn: true,
    verses,
  },
];
