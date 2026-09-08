export const BIBLE_BOOKS = [
  // Old Testament (id 1-39)
  { id: 1, testament: 'OT', names: ["創世記", "創", "Genesis", "Gen"], ja: "創", ko: "창", es: "Gn", de: "1Mo", tr: "Yar", fa: "پید", he: "בר", my: "ကမ္ဘာ" , ar: "تك", vi: "Sáng" , idn: "Kejadian", msy: "Kejadian", pt: "Gênesis", fr: "Genèse", ru: "Бытие", hi: "उत्पत्ति", cn: ["创世记", "创"] },
  { id: 2, testament: 'OT', names: ["出埃及記", "出", "Exodus", "Exo"], ja: "出", ko: "출", es: "Ex", de: "2Mo", tr: "Çık", fa: "خروج", he: "שמ", my: "ထွက်" , ar: "خر", vi: "Xuất" , idn: "Keluaran", msy: "Keluaran", pt: "Êxodo", fr: "Exode", ru: "Исход", hi: "निर्गमन", cn: ["出埃及记", "出"] },
  { id: 3, testament: 'OT', names: ["利未記", "利", "Leviticus", "Lev"], ja: "レビ", ko: "레", es: "Lv", de: "3Mo", tr: "Lev", fa: "لاو", he: "וי", my: "ဝတ်" , ar: "لا", vi: "Lê" , idn: "Imamat", msy: "Imamat", pt: "Levítico", fr: "Lévitique", ru: "Левит", hi: "लैव्यव्यवस्था", cn: ["利未记", "利"] },
  { id: 4, testament: 'OT', names: ["民數記", "民", "Numbers", "Num"], ja: "民", ko: "민", es: "Nm", de: "4Mo", tr: "Çöl", fa: "اعد", he: "במ", my: "တော" , ar: "عد", vi: "Dân" , idn: "Bilangan", msy: "Bilangan", pt: "Números", fr: "Nombres", ru: "Числа", hi: "गिनती", cn: ["民数记", "民"] },
  { id: 5, testament: 'OT', names: ["申命記", "申", "Deuteronomy", "Deut"], ja: "申", ko: "신", es: "Dt", de: "5Mo", tr: "Yas", fa: "تثن", he: "דב", my: "တရား" , ar: "تث", vi: "Phục" , idn: "Ulangan", msy: "Ulangan", pt: "Deuteronômio", fr: "Deutéronome", ru: "Второзаконие", hi: "व्यवस्थाविवरण", cn: ["申命记", "申"] },
  { id: 6, testament: 'OT', names: ["約書亞記", "書", "Joshua", "Josh"], ja: "ヨシ", ko: "수", es: "Jos", de: "Jos", tr: "Yşu", fa: "یوش", he: "יה", my: "ယောရှု" , ar: "يش", vi: "Giô" , idn: "Yosua", msy: "Yosua", pt: "Josué", fr: "Josué", ru: "Иисус Навин", hi: "यहोशू", cn: ["约书亚记", "书"] },
  { id: 7, testament: 'OT', names: ["士師記", "士", "Judges", "Judg"], ja: "士", ko: "삿", es: "Jue", de: "Ri", tr: "Hak", fa: "داو", he: "שפ", my: "တရားသူ" , ar: "قض", vi: "Quan" , idn: "Hakim-hakim", msy: "Hakim-hakim", pt: "Juízes", fr: "Juges", ru: "Судьи", hi: "न्यायियों", cn: ["士师记", "士"] },
  { id: 8, testament: 'OT', names: ["路得記", "得", "Ruth", "Ru"], ja: "ルツ", ko: "룻", es: "Rt", de: "Rt", tr: "Rut", fa: "روت", he: "רת", my: "ရုသ" , ar: "را", vi: "Ru" , idn: "Rut", msy: "Rut", pt: "Rute", fr: "Ruth", ru: "Руфь", hi: "रूत", cn: ["路得记", "得"] },
  { id: 9, testament: 'OT', names: ["撒母耳記上", "撒上", "1 Samuel", "1 Sam"], ja: "Ⅰサム", ko: "삼상", es: "1S", de: "1Sa", tr: "1Sa", fa: "۱سم", he: "שא", my: "၁ဓမ္မ" , ar: "1صم", vi: "1 Sa" , idn: "1 Samuel", msy: "1 Samuel", pt: "1 Samuel", fr: "1 Samuel", ru: "1 Царств", hi: "1 शमूएल", cn: ["撒母耳记上", "撒上"] },
  { id: 10, testament: 'OT', names: ["撒母耳記下", "撒下", "2 Samuel", "2 Sam"], ja: "Ⅱサム", ko: "삼하", es: "2S", de: "2Sa", tr: "2Sa", fa: "۲سم", he: "שב", my: "၂ဓမ္မ" , ar: "2صم", vi: "2 Sa" , idn: "2 Samuel", msy: "2 Samuel", pt: "2 Samuel", fr: "2 Samuel", ru: "2 Царств", hi: "2 शमूएल", cn: ["撒母耳记下", "撒下"] },
  { id: 11, testament: 'OT', names: ["列王紀上", "王上", "1 Kings", "1 Kgs"], ja: "Ⅰ列王", ko: "왕상", es: "1R", de: "1Kö", tr: "1Kr", fa: "۱پاد", he: "מא", my: "၃ဓမ္မ" , ar: "1مل", vi: "1 Vua" , idn: "1 Raja-raja", msy: "1 Raja-raja", pt: "1 Reis", fr: "1 Rois", ru: "3 Царств", hi: "1 राजा", cn: ["列王纪上", "王上"] },
  { id: 12, testament: 'OT', names: ["列王紀下", "王下", "2 Kings", "2 Kgs"], ja: "Ⅱ列王", ko: "왕하", es: "2R", de: "2Kö", tr: "2Kr", fa: "۲پاد", he: "מב", my: "၄ဓမ္မ" , ar: "2مل", vi: "2 Vua" , idn: "2 Raja-raja", msy: "2 Raja-raja", pt: "2 Reis", fr: "2 Rois", ru: "4 Царств", hi: "2 राजा", cn: ["列王纪下", "王下"] },
  { id: 13, testament: 'OT', names: ["歷代志上", "代上", "1 Chronicles", "1 Chr"], ja: "Ⅰ歴代", ko: "대상", es: "1Cr", de: "1Ch", tr: "1Ta", fa: "۱توا", he: "דא", my: "၁ရာ" , ar: "1أخ", vi: "1 Sử" , idn: "1 Tawarikh", msy: "1 Tawarikh", pt: "1 Crônicas", fr: "1 Chroniques", ru: "1 Паралипоменон", hi: "1 इतिहास", cn: ["历代志上", "代上"] },
  { id: 14, testament: 'OT', names: ["歷代志下", "代下", "2 Chronicles", "2 Chr"], ja: "Ⅱ歴代", ko: "대하", es: "2Cr", de: "2Ch", tr: "2Ta", fa: "۲توا", he: "דב", my: "၂ရာ" , ar: "2أخ", vi: "2 Sử" , idn: "2 Tawarikh", msy: "2 Tawarikh", pt: "2 Crônicas", fr: "2 Chroniques", ru: "2 Паралипоменон", hi: "2 इतिहास", cn: ["历代志下", "代下"] },
  { id: 15, testament: 'OT', names: ["以斯拉記", "拉", "Ezra", "Ezr"], ja: "エズ", ko: "스", es: "Esd", de: "Esr", tr: "Ezr", fa: "عزرا", he: "עז", my: "ဧဇရ" , ar: "عز", vi: "Ê-xơ" , idn: "Ezra", msy: "Ezra", pt: "Esdras", fr: "Esdras", ru: "Ездра", hi: "एज्रा", cn: ["以斯拉记", "拉"] },
  { id: 16, testament: 'OT', names: ["尼希米記", "尼", "Nehemiah", "Neh"], ja: "ネヘ", ko: "느", es: "Neh", de: "Neh", tr: "Neh", fa: "نحم", he: "נח", my: "နေ" , ar: "نح", vi: "Nê" , idn: "Nehemia", msy: "Nehemia", pt: "Neemias", fr: "Néhémie", ru: "Неемия", hi: "नहेम्याह", cn: ["尼希米记", "尼"] },
  { id: 17, testament: 'OT', names: ["以斯帖記", "斯", "Esther", "Est"], ja: "エス", ko: "에", es: "Est", de: "Est", tr: "Est", fa: "استر", he: "אס", my: "ဧသတာ" , ar: "أس", vi: "Ê-st" , idn: "Ester", msy: "Ester", pt: "Ester", fr: "Esther", ru: "Есфирь", hi: "एस्तेर", cn: ["以斯帖记", "斯"] },
  { id: 18, testament: 'OT', names: ["約伯記", "伯", "Job", "Jb"], ja: "ヨブ", ko: "욥", es: "Job", de: "Hi", tr: "Eyü", fa: "ایوب", he: "אי", my: "ယောဘ" , ar: "أي", vi: "Gióp" , idn: "Ayub", msy: "Ayub", pt: "Jó", fr: "Job", ru: "Иов", hi: "अय्यूब", cn: ["约伯记", "伯"] },
  { id: 19, testament: 'OT', names: ["詩篇", "詩", "Psalms", "Psalm", "Ps"], ja: "詩", ko: "시", es: "Sal", de: "Ps", tr: "Mez", fa: "مز", he: "תה", my: "ဆာ" , ar: "مز", vi: "Thi" , idn: "Mazmur", msy: "Mazmur", pt: "Salmos", fr: "Psaumes", ru: "Псалтирь", hi: "भजन संहिता", cn: ["诗篇", "诗"] },
  { id: 20, testament: 'OT', names: ["箴言", "箴", "Proverbs", "Prv"], ja: "箴", ko: "잠", es: "Pr", de: "Spr", tr: "SüM", fa: "امث", he: "מש", my: "သု" , ar: "أم", vi: "Châm" , idn: "Amsal", msy: "Amsal", pt: "Provérbios", fr: "Proverbes", ru: "Притчи", hi: "नीतिवचन", cn: ["箴言", "箴"] },
  { id: 21, testament: 'OT', names: ["傳道書", "傳", "Ecclesiastes", "Eccl"], ja: "伝", ko: "전", es: "Ec", de: "Pred", tr: "Vai", fa: "جا", he: "קה", my: "ဒေသနာ" , ar: "جا", vi: "Truyền" , idn: "Pengkhotbah", msy: "Pengkhotbah", pt: "Eclesiastes", fr: "Ecclésiaste", ru: "Екклесиаст", hi: "सभोपदेशक", cn: ["传道书", "传"] },
  { id: 22, testament: 'OT', names: ["雅歌", "歌", "Song of Solomon", "SS"], ja: "雅", ko: "아", es: "Cnt", de: "Hl", tr: "Ezi", fa: "غزل", he: "שי", my: "ရှော" , ar: "نش", vi: "Nhã" , idn: "Kidung Agung", msy: "Kidung Agung", pt: "Cânticos", fr: "Cantique des cantiques", ru: "Песнь Песней", hi: "श्रेष्ठगीत", cn: ["雅歌", "歌"] },
  { id: 23, testament: 'OT', names: ["以賽亞書", "賽", "Isaiah", "Isa"], ja: "イザ", ko: "사", es: "Is", de: "Jes", tr: "Yşa", fa: "اشع", he: "יש", my: "ဟေရှာ" , ar: "إش", vi: "Ê-sai" , idn: "Yesaya", msy: "Yesaya", pt: "Isaías", fr: "Ésaïe", ru: "Исаия", hi: "यशायाह", cn: ["以赛亚书", "赛"] },
  { id: 24, testament: 'OT', names: ["耶利米書", "耶", "Jeremiah", "Jer"], ja: "エレ", ko: "렘", es: "Jr", de: "Jer", tr: "Yer", fa: "ارم", he: "יר", my: "ယေရ" , ar: "إر", vi: "Giê" , idn: "Yeremia", msy: "Yeremia", pt: "Jeremias", fr: "Jérémie", ru: "Иеремия", hi: "यिर्मयाह", cn: ["耶利米书", "耶"] },
  { id: 25, testament: 'OT', names: ["耶利米哀歌", "哀", "Lamentations", "Lam"], ja: "哀", ko: "애", es: "Lm", de: "Kla", tr: "Ağı", fa: "مرا", he: "איכ", my: "မြည်" , ar: "مرا", vi: "Ca" , idn: "Ratapan", msy: "Ratapan", pt: "Lamentações", fr: "Lamentations", ru: "Плач Иеремии", hi: "विलापगीत", cn: ["耶利米哀歌", "哀"] },
  { id: 26, testament: 'OT', names: ["以西結書", "結", "Ezekiel", "Ezek"], ja: "エゼ", ko: "겔", es: "Ez", de: "Hes", tr: "Hez", fa: "حز", he: "יח", my: "ယေဇ" , ar: "حز", vi: "Ê-xê" , idn: "Yehezkiel", msy: "Yehezkiel", pt: "Ezequiel", fr: "Ézéchiel", ru: "Иезекииль", hi: "यहेजकेल", cn: ["以西结书", "结"] },
  { id: 27, testament: 'OT', names: ["但以理書", "但", "Daniel", "Dan"], ja: "ダニ", ko: "단", es: "Dn", de: "Dan", tr: "Dan", fa: "دان", he: "דנ", my: "ဒံ" , ar: "دا", vi: "Đa" , idn: "Daniel", msy: "Daniel", pt: "Daniel", fr: "Daniel", ru: "Даниил", hi: "दानिय्येल", cn: ["但以理书", "但"] },
  { id: 28, testament: 'OT', names: ["何西阿書", "何", "Hosea", "Hos"], ja: "ホセ", ko: "호", es: "Os", de: "Hos", tr: "Hoş", fa: "هوش", he: "הוש", my: "ဟော" , ar: "هو", vi: "Ô-sê" , idn: "Hosea", msy: "Hosea", pt: "Oseias", fr: "Osée", ru: "Осия", hi: "होशे", cn: ["何西阿书", "何"] },
  { id: 29, testament: 'OT', names: ["約珥書", "珥", "Joel", "Jl"], ja: "ヨエ", ko: "욜", es: "Jl", de: "Joe", tr: "Yoe", fa: "یوئ", he: "יוא", my: "ယောလ" , ar: "يوء", vi: "Giô-ên" , idn: "Yoel", msy: "Yoel", pt: "Joel", fr: "Joël", ru: "Иоиль", hi: "योएल", cn: ["约珥书", "珥"] },
  { id: 30, testament: 'OT', names: ["阿摩司書", "摩", "Amos", "Am"], ja: "アモ", ko: "암", es: "Am", de: "Am", tr: "Amo", fa: "عام", he: "עמ", my: "အာ" , ar: "عا", vi: "A-mốt" , idn: "Amos", msy: "Amos", pt: "Amós", fr: "Amos", ru: "Амос", hi: "आमोस", cn: ["阿摩司书", "摩"] },
  { id: 31, testament: 'OT', names: ["俄巴底亞書", "俄", "Obadiah", "Ob"], ja: "オバ", ko: "옵", es: "Abd", de: "Ob", tr: "Ova", fa: "عوب", he: "עב", my: "ဩ" , ar: "عو", vi: "Áp" , idn: "Obaja", msy: "Obaja", pt: "Obadias", fr: "Abdias", ru: "Авдий", hi: "ओबद्याह", cn: ["俄巴底亚书", "俄"] },
  { id: 32, testament: 'OT', names: ["約拿書", "拿", "Jonah", "Jon"], ja: "ヨナ", ko: "욘", es: "Jon", de: "Jon", tr: "Yun", fa: "یون", he: "יונ", my: "ယောန" , ar: "يون", vi: "Giô-na" , idn: "Yunus", msy: "Yunus", pt: "Jonas", fr: "Jonas", ru: "Иона", hi: "योना", cn: ["约拿书", "拿"] },
  { id: 33, testament: 'OT', names: ["彌迦書", "彌", "Micah", "Mic"], ja: "ミカ", ko: "미", es: "Mi", de: "Mi", tr: "Mik", fa: "میک", he: "מי", my: "မိက္ခာ" , ar: "مي", vi: "Mi" , idn: "Mikha", msy: "Mikha", pt: "Miqueias", fr: "Michée", ru: "Михей", hi: "मीका", cn: ["弥迦书", "弥"] },
  { id: 34, testament: 'OT', names: ["那鴻書", "鴻", "Nahum", "Nah"], ja: "ナホ", ko: "나", es: "Nah", de: "Nah", tr: "Nah", fa: "ناح", he: "נח", my: "နာဟုံ" , ar: "نا", vi: "Na" , idn: "Nahum", msy: "Nahum", pt: "Naum", fr: "Nahum", ru: "Наум", hi: "नहूम", cn: ["那鸿书", "鸿"] },
  { id: 35, testament: 'OT', names: ["哈巴谷書", "哈", "Habakkuk", "Hab"], ja: "ハバ", ko: "합", es: "Hab", de: "Hab", tr: "Hab", fa: "حبق", he: "חב", my: "ဟဗ" , ar: "حب", vi: "Ha" , idn: "Habakuk", msy: "Habakuk", pt: "Habacuque", fr: "Habacuc", ru: "Аввакум", hi: "हबक्कूक", cn: ["哈巴谷书", "哈"] },
  { id: 36, testament: 'OT', names: ["西番雅書", "番", "Zephaniah", "Zeph"], ja: "ゼパ", ko: "습", es: "Sof", de: "Zef", tr: "Sef", fa: "صفن", he: "צפ", my: "ဇေ" , ar: "صف", vi: "Sô" , idn: "Zefanya", msy: "Zefanya", pt: "Sofonias", fr: "Sophonie", ru: "Софония", hi: "सपन्याह", cn: ["西番雅书", "番"] },
  { id: 37, testament: 'OT', names: ["哈該書", "該", "Haggai", "Hag"], ja: "ハガ", ko: "학", es: "Ag", de: "Hag", tr: "Hag", fa: "حجی", he: "חג", my: "ဟဂ္ဂဲ" , ar: "حج", vi: "A-gai" , idn: "Hagai", msy: "Hagai", pt: "Ageu", fr: "Aggée", ru: "Аггей", hi: "हाग्गै", cn: ["哈该书", "该"] },
  { id: 38, testament: 'OT', names: ["撒迦利亞書", "亞", "Zechariah", "Zech"], ja: "ゼカ", ko: "슥", es: "Zac", de: "Sach", tr: "Zek", fa: "زکر", he: "זכ", my: "ဇာ" , ar: "زك", vi: "Xa" , idn: "Zakharia", msy: "Zakharia", pt: "Zacarias", fr: "Zacharie", ru: "Захария", hi: "जकर्याह", cn: ["撒迦利亚书", "亚"] },
  { id: 39, testament: 'OT', names: ["瑪拉基書", "瑪", "Malachi", "Mal"], ja: "マラ", ko: "말", es: "Mal", de: "Mal", tr: "Mal", fa: "ملا", he: "מל", my: "မာ" , ar: "ملا", vi: "Ma-la" , idn: "Maleakhi", msy: "Maleakhi", pt: "Malaquias", fr: "Malachie", ru: "Малахия", hi: "मलाकी", cn: ["玛拉基书", "玛"] },
  // New Testament (id 40-66)
  { id: 40, testament: 'NT', names: ["馬太福音", "太", "Matthew", "Matt"], ja: "マタ", ko: "마", es: "Mt", de: "Mt", tr: "Mat", fa: "مت", he: "מת", my: "မဿဲ" , ar: "مت", vi: "Ma" , idn: "Matius", msy: "Matius", pt: "Mateus", fr: "Matthieu", ru: "Матфея", hi: "मत्ती", cn: ["马太福音", "太"] },
  { id: 41, testament: 'NT', names: ["馬可福音", "可", "Mark", "Mk"], ja: "マコ", ko: "막", es: "Mr", de: "Mk", tr: "Mar", fa: "مر", he: "מר", my: "မာကု" , ar: "مر", vi: "Mác" , idn: "Markus", msy: "Markus", pt: "Marcos", fr: "Marc", ru: "Марка", hi: "मरकुस", cn: ["马可福音", "可"] },
  { id: 42, testament: 'NT', names: ["路加福音", "路", "Luke", "Lk"], ja: "ルカ", ko: "눅", es: "Lc", de: "Lk", tr: "Luk", fa: "لو", he: "לוק", my: "လုကာ" , ar: "لو", vi: "Lu" , idn: "Lukas", msy: "Lukas", pt: "Lucas", fr: "Luc", ru: "Луки", hi: "लूका", cn: ["路加福音", "路"] },
  { id: 43, testament: 'NT', names: ["約翰福音", "約", "John", "Jn"], ja: "ヨハ", ko: "요", es: "Jn", de: "Joh", tr: "Yu", fa: "یوح", he: "יוח", my: "ယောဟန်" , ar: "يو", vi: "Giăng" , idn: "Yohanes", msy: "Yohanes", pt: "João", fr: "Jean", ru: "Иоанна", hi: "यूहन्ना", cn: ["约翰福音", "约"] },
  { id: 44, testament: 'NT', names: ["使徒行傳", "徒", "Acts", "Acts"], ja: "使", ko: "행", es: "Hch", de: "Apg", tr: "Elç", fa: "اعم", he: "מע", my: "တမန်" , ar: "أع", vi: "Công" , idn: "Kisah Para Rasul", msy: "Kisah Para Rasul", pt: "Atos", fr: "Actes", ru: "Деяния", hi: "प्रेरितों के काम", cn: ["使徒行传", "徒"] },
  { id: 45, testament: 'NT', names: ["羅馬書", "羅", "Romans", "Rom"], ja: "ロマ", ko: "롬", es: "Ro", de: "Röm", tr: "Rom", fa: "روم", he: "רו", my: "ရောမ" , ar: "رو", vi: "Rô" , idn: "Roma", msy: "Roma", pt: "Romanos", fr: "Romains", ru: "Римлянам", hi: "रोमियों", cn: ["罗马书", "罗"] },
  { id: 46, testament: 'NT', names: ["哥林多前書", "林前", "1 Corinthians", "1 Cor"], ja: "Ⅰコリ", ko: "고전", es: "1Co", de: "1Ko", tr: "1Ko", fa: "۱قر", he: "קא", my: "၁ကော" , ar: "1كو", vi: "1 Cô" , idn: "1 Korintus", msy: "1 Korintus", pt: "1 Coríntios", fr: "1 Corinthiens", ru: "1 Коринфянам", hi: "1 कुरिन्थियों", cn: ["哥林多前书", "林前"] },
  { id: 47, testament: 'NT', names: ["哥林多後書", "林後", "2 Corinthians", "2 Cor"], ja: "Ⅱコリ", ko: "고후", es: "2Co", de: "2Ko", tr: "2Ko", fa: "۲قر", he: "קב", my: "၂ကော" , ar: "2كو", vi: "2 Cô" , idn: "2 Korintus", msy: "2 Korintus", pt: "2 Coríntios", fr: "2 Corinthiens", ru: "2 Коринфянам", hi: "2 कुरिन्थियों", cn: ["哥林多后书", "林后"] },
  { id: 48, testament: 'NT', names: ["加拉太書", "加", "Galatians", "Gal"], ja: "ガラ", ko: "갈", es: "Gl", de: "Gal", tr: "Gal", fa: "غلا", he: "גל", my: "ဂလာ" , ar: "غل", vi: "Ga" , idn: "Galatia", msy: "Galatia", pt: "Gálatas", fr: "Galates", ru: "Галатам", hi: "गलातियों", cn: ["加拉太书", "加"] },
  { id: 49, testament: 'NT', names: ["以弗所書", "弗", "Ephesians", "Eph"], ja: "エペ", ko: "엡", es: "Ef", de: "Eph", tr: "Efe", fa: "افس", he: "אפ", my: "ဧဖက်" , ar: "أف", vi: "Ê-phê" , idn: "Efesus", msy: "Efesus", pt: "Efésios", fr: "Éphésiens", ru: "Ефесянам", hi: "इफिसियों", cn: ["以弗所书", "弗"] },
  { id: 50, testament: 'NT', names: ["腓立比書", "腓", "Philippians", "Phil"], ja: "ピリ", ko: "빌", es: "Flp", de: "Phil", tr: "Flp", fa: "فیل", he: "פיל", my: "ဖိ" , ar: "في", vi: "Phi" , idn: "Filipi", msy: "Filipi", pt: "Filipenses", fr: "Philippiens", ru: "Филиппийцам", hi: "फिलिप्पियों", cn: ["腓立比书", "腓"] },
  { id: 51, testament: 'NT', names: ["歌羅西書", "西", "Colossians", "Col"], ja: "コロ", ko: "골", es: "Col", de: "Kol", tr: "Kol", fa: "کول", he: "קול", my: "ကော" , ar: "كو", vi: "Cô" , idn: "Kolose", msy: "Kolose", pt: "Colossenses", fr: "Colossiens", ru: "Колоссянам", hi: "कुलुस्सियों", cn: ["歌罗西书", "西"] },
  { id: 52, testament: 'NT', names: ["帖撒羅尼迦前書", "帖前", "1 Thessalonians", "1 Thess"], ja: "Ⅰテサ", ko: "살전", es: "1Ts", de: "1Th", tr: "1Se", fa: "۱تس", he: "תא", my: "၁သက်" , ar: "1تس", vi: "1 Tê" , idn: "1 Tesalonika", msy: "1 Tesalonika", pt: "1 Tessalonicenses", fr: "1 Thessaloniciens", ru: "1 Фессалоникийцам", hi: "1 थिस्सलुनीकियों", cn: ["帖撒罗尼迦前书", "帖前"] },
  { id: 53, testament: 'NT', names: ["帖撒羅尼迦後書", "帖後", "2 Thessalonians", "2 Thess"], ja: "Ⅱテサ", ko: "살후", es: "2Ts", de: "2Th", tr: "2Se", fa: "۲تس", he: "תב", my: "၂သက်" , ar: "2تس", vi: "2 Tê" , idn: "2 Tesalonika", msy: "2 Tesalonika", pt: "2 Tessalonicenses", fr: "2 Thessaloniciens", ru: "2 Фессалоникийцам", hi: "2 थिस्सलुनीकियों", cn: ["帖撒罗尼迦后书", "帖后"] },
  { id: 54, testament: 'NT', names: ["提摩太前書", "提前", "1 Timothy", "1 Tim"], ja: "Ⅰテモ", ko: "딤전", es: "1Ti", de: "1Ti", tr: "1Ti", fa: "۱تیم", he: "טימא", my: "၁တိ" , ar: "1تي", vi: "1 Ti" , idn: "1 Timotius", msy: "1 Timotius", pt: "1 Timóteo", fr: "1 Timothée", ru: "1 Тимофею", hi: "1 तीमुथियुस", cn: ["提摩太前书", "提前"] },
  { id: 55, testament: 'NT', names: ["提摩太後書", "提後", "2 Timothy", "2 Tim"], ja: "Ⅱテモ", ko: "딤후", es: "2Ti", de: "2Ti", tr: "2Ti", fa: "۲تیم", he: "טימב", my: "၂တိ" , ar: "2تي", vi: "2 Ti" , idn: "2 Timotius", msy: "2 Timotius", pt: "2 Timóteo", fr: "2 Timothée", ru: "2 Тимофею", hi: "2 तीमुथियुस", cn: ["提摩太后书", "提后"] },
  { id: 56, testament: 'NT', names: ["提多書", "多", "Titus", "Tit"], ja: "テト", ko: "딛", es: "Tit", de: "Tit", tr: "Tit", fa: "تیت", he: "טיט", my: "တိတု" , ar: "تي", vi: "Tít" , idn: "Titus", msy: "Titus", pt: "Tito", fr: "Tite", ru: "Титу", hi: "तीतुस", cn: ["提多书", "多"] },
  { id: 57, testament: 'NT', names: ["腓利門書", "門", "Philemon", "Phlm"], ja: "ピレ", ko: "몬", es: "Flm", de: "Phm", tr: "Flm", fa: "فلیم", he: "פיל", my: "ဖိလေ" , ar: "فل", vi: "Phi-lê" , idn: "Filemon", msy: "Filemon", pt: "Filemom", fr: "Philémon", ru: "Филимону", hi: "फिलेमोन", cn: ["腓利门书", "门"] },
  { id: 58, testament: 'NT', names: ["希伯來書", "來", "Hebrews", "Heb"], ja: "ヘブ", ko: "히", es: "Heb", de: "Heb", tr: "İbr", fa: "عبر", he: "עב", my: "ဟေဗြဲ" , ar: "عب", vi: "Hê" , idn: "Ibrani", msy: "Ibrani", pt: "Hebreus", fr: "Hébreux", ru: "Евреям", hi: "इब्रानियों", cn: ["希伯来书", "来"] },
  { id: 59, testament: 'NT', names: ["雅各書", "雅", "James", "Jas"], ja: "ヤコ", ko: "약", es: "Stg", de: "Jak", tr: "Yak", fa: "یعق", he: "יע", my: "ယာကုပ်" , ar: "يع", vi: "Gia" , idn: "Yakobus", msy: "Yakobus", pt: "Tiago", fr: "Jacques", ru: "Иакова", hi: "याकूब", cn: ["雅各书", "雅"] },
  { id: 60, testament: 'NT', names: ["彼得前書", "彼前", "1 Peter", "1 Pet"], ja: "Ⅰペテ", ko: "벧전", es: "1P", de: "1Pe", tr: "1Pe", fa: "۱پط", he: "פטא", my: "၁ပေ" , ar: "1بط", vi: "1 Phi" , idn: "1 Petrus", msy: "1 Petrus", pt: "1 Pedro", fr: "1 Pierre", ru: "1 Петра", hi: "1 पतरस", cn: ["彼得前书", "彼前"] },
  { id: 61, testament: 'NT', names: ["彼得後書", "彼後", "2 Peter", "2 Pet"], ja: "Ⅱペテ", ko: "벧후", es: "2P", de: "2Pe", tr: "2Pe", fa: "۲پط", he: "פטב", my: "၂ပေ" , ar: "2بط", vi: "2 Phi" , idn: "2 Petrus", msy: "2 Petrus", pt: "2 Pedro", fr: "2 Pierre", ru: "2 Петра", hi: "2 पतरस", cn: ["彼得后书", "彼后"] },
  { id: 62, testament: 'NT', names: ["約翰一書", "約一", "1 John", "1 Jn"], ja: "Ⅰヨハ", ko: "요일", es: "1Jn", de: "1Jo", tr: "1Yu", fa: "۱یوح", he: "יוחא", my: "၁ယော" , ar: "1يو", vi: "1 Giăng" , idn: "1 Yohanes", msy: "1 Yohanes", pt: "1 João", fr: "1 Jean", ru: "1 Иоанна", hi: "1 यूहन्ना", cn: ["约翰一书", "约一"] },
  { id: 63, testament: 'NT', names: ["約翰二書", "約二", "2 John", "2 Jn"], ja: "Ⅱヨハ", ko: "요이", es: "2Jn", de: "2Jo", tr: "2Yu", fa: "۲یوح", he: "יוחב", my: "၂ယော" , ar: "2يو", vi: "2 Giăng" , idn: "2 Yohanes", msy: "2 Yohanes", pt: "2 João", fr: "2 Jean", ru: "2 Иоанна", hi: "2 यूहन्ना", cn: ["约翰二书", "约二"] },
  { id: 64, testament: 'NT', names: ["約翰三書", "約三", "3 John", "3 Jn"], ja: "Ⅲヨハ", ko: "요삼", es: "3Jn", de: "3Jo", tr: "3Yu", fa: "۳یوح", he: "יוחג", my: "၃ယော" , ar: "3يو", vi: "3 Giăng" , idn: "3 Yohanes", msy: "3 Yohanes", pt: "3 João", fr: "3 Jean", ru: "3 Иоанна", hi: "3 यूहन्ना", cn: ["约翰三书", "约三"] },
  { id: 65, testament: 'NT', names: ["猶大書", "猶", "Jude", "Jude"], ja: "ユダ", ko: "유", es: "Jud", de: "Jud", tr: "Yah", fa: "یهو", he: "יהו", my: "ယုဒ" , ar: "يهو", vi: "Giu" , idn: "Yudas", msy: "Yudas", pt: "Judas", fr: "Jude", ru: "Иуды", hi: "यहूदा", cn: ["犹大书", "犹"] },
  { id: 66, testament: 'NT', names: ["啟示錄", "啟", "Revelation", "Rev"], ja: "黙", ko: "계", es: "Ap", de: "Offb", tr: "Esi", fa: "مکا", he: "התג", my: "ဗျာ" , ar: "رؤ", vi: "Khải" , idn: "Wahyu", msy: "Wahyu", pt: "Apocalipse", fr: "Apocalypse", ru: "Откровение", hi: "प्रकाशितवाक्य", cn: ["启示录", "启"] }
];

// Get the display abbreviation for a book based on language version
export function getBookAbbr(book, version) {
  if (version === 'ja') return book.ja;
  if (version === 'ko') return book.ko;
  if (version === 'es') return book.es;
  if (version === 'de') return book.de;
  if (version === 'tr') return book.tr;
  if (version === 'fa') return book.fa;
  if (version === 'he') return book.he;
  if (version === 'my') return book.my;
  if (version === 'vi') return book.vi || book.names[3]; // Fallback to English abbr
  if (version === 'id') return book.idn || book.names[3]; // Indonesian: use full name (TB has no widely-used abbr)
  if (version === 'ms') return book.msy || book.names[3]; // Malay: use full name
  if (version === 'pt') return book.pt || book.names[3]; // Portuguese: use full name
  if (version === 'fr') return book.fr || book.names[3]; // French: use full name
  if (version === 'ru') return book.ru || book.names[3]; // Russian: use full name
  if (version === 'hi') return book.hi || book.names[3]; // Hindi: use full name
  if (version === 'kjv' || version === 'esv' || version === 'niv') return book.names[3]; // English abbr
  if (version === 'cuvs') return book.cn[1]; // Simplified Chinese abbr
  return book.names[1]; // Chinese abbr
}

// Get the full name for a book based on language version
export function getBookFullName(book, version) {
  if (version === 'ja') return book.ja;
  if (version === 'ko') return book.ko;
  if (version === 'es') return book.es;
  if (version === 'de') return book.de;
  if (version === 'tr') return book.tr;
  if (version === 'fa') return book.fa;
  if (version === 'he') return book.he;
  if (version === 'my') return book.my;
  if (version === 'vi') return book.vi || book.names[2]; // Fallback to English full name
  if (version === 'id') return book.idn || book.names[2]; // Indonesian full name
  if (version === 'ms') return book.msy || book.names[2]; // Malay full name
  if (version === 'pt') return book.pt || book.names[2]; // Portuguese full name
  if (version === 'fr') return book.fr || book.names[2]; // French full name
  if (version === 'ru') return book.ru || book.names[2]; // Russian full name
  if (version === 'hi') return book.hi || book.names[2]; // Hindi full name
  if (version === 'kjv' || version === 'esv' || version === 'niv') return book.names[2]; // English full
  if (version === 'cuvs') return book.cn[0]; // Simplified Chinese full
  return book.names[0]; // Chinese full
}
