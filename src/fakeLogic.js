export const getRandomFakePhrase = (version, allVerses) => {
    const isEnglish = version === 'kjv' || version === 'esv';
    const regex = isEnglish ? /[,，。；：「」、;:\.\?!]/ : /[\s,，。；：「」、;:\.\?!！？『』《》]/;
    
    if (!allVerses || allVerses.length === 0) return "阿門";
    const randomVerse = allVerses[Math.floor(Math.random() * allVerses.length)];
    const phrases = randomVerse.text.split(regex).map(p => p.trim()).filter(Boolean);
    return phrases[Math.floor(Math.random() * phrases.length)] || "阿門";
};
