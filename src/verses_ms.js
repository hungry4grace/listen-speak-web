// Bahasa Melayu (Malay) built-in verse sets.
//
// IMPORTANT: No free public API exists for the most-used Malay Bible
// translations (AVB / TMV Alkitab Berita Baik). For now the secondary-
// language lookup and Topic: set conversion both reuse the Indonesian
// Terjemahan Baru (TB) text — Malay and Indonesian are ~80% mutually
// intelligible. When a Malay Bible API becomes available, swap the
// 'ms' entry in BOLLS_TRANSLATIONS and re-publish Topic sets.
//
// Topic: themed sets ("Covenant", "heal", "mercy", etc.) are published
// to PartyKit at runtime and loaded via publishedVerseSets — they are
// NOT stored in this file.
export const VERSE_SETS_MS = [
  {
    id: "inherit-land-ms",
    title: `Mewarisi Bumi — Wahyu Mazmur 37`,
    createdAt: "2026-06-07",
    description: `<h2>Mewarisi Bumi: Janji yang Kuno dan Kekal</h2>
<p>Mazmur 37 adalah mazmur hikmat yang ditulis Daud di masa tuanya (ay. 25), dan tema pokoknya berkisar pada janji yang diulang lima kali: <strong>"orang yang lemah lembut akan mewarisi bumi"</strong> (ay. 9, 11, 22, 29, 34). Yesus mengesahkan janji purba ini dalam Khotbah di Bukit: "Berbahagialah orang yang lemah lembut, kerana mereka akan mewarisi bumi" (Mat. 5:5).</p>
<p>Daud menggambarkan ciri-ciri mereka yang menerima warisan ini: <strong>percayalah kepada TUHAN dan lakukanlah kebaikan</strong>, <strong>bersukacitalah dalam TUHAN</strong>, <strong>serahkanlah jalanmu kepada TUHAN</strong> dan <strong>berdiamlah di hadapan TUHAN dan nantikanlah Dia</strong> (ay. 3-7). Mereka yang menjauhi kejahatan dan melakukan kebaikan (ay. 27) dan menantikan TUHAN akan ditinggikan dan mewarisi bumi (ay. 34).</p>
<p>Yesaya 57:13 berjanji: "Orang yang bernaung kepada-Ku akan mewarisi bumi." Kuncinya bukan jasa kita tetapi pilihan untuk berlindung kepada Tuhan.</p>`,
    language: "ms",
    verses: [
      { id: "inherit-land-ms-1", reference: "Mazmur 25:12-13", title: `Mewarisi Bumi — Wahyu Mazmur 37`, text: `Siapakah orang yang takut akan Tuhan? Kepadanya Tuhan menunjukkan jalan yang harus dipilihnya. Orang itu sendiri akan menetap dalam kebahagiaan dan anak cucunya akan mewarisi bumi.` },
      { id: "inherit-land-ms-2", reference: "Mazmur 37:9", title: `Mewarisi Bumi — Wahyu Mazmur 37`, text: `Sebab orang-orang yang berbuat jahat akan dilenyapkan, tetapi orang-orang yang menanti-nantikan Tuhan akan mewarisi negeri.` },
      { id: "inherit-land-ms-3", reference: "Mazmur 37:11", title: `Mewarisi Bumi — Wahyu Mazmur 37`, text: `Tetapi orang-orang yang rendah hati akan mewarisi negeri dan bergembira karena kesejahteraan yang berlimpah-limpah.` },
      { id: "inherit-land-ms-4", reference: "Mazmur 37:21-22", title: `Mewarisi Bumi — Wahyu Mazmur 37`, text: `Orang fasik meminjam dan tidak membayar kembali, tetapi orang benar adalah pengasih dan pemurah. Sesungguhnya, orang-orang yang diberkati-Nya akan mewarisi negeri, tetapi orang-orang yang dikutuki-Nya akan dilenyapkan.` },
      { id: "inherit-land-ms-5", reference: "Mazmur 37:27-29", title: `Mewarisi Bumi — Wahyu Mazmur 37`, text: `Jauhilah yang jahat dan lakukanlah yang baik, maka engkau akan tetap tinggal untuk selama-lamanya; sebab Tuhan mencintai hukum, dan Ia tidak meninggalkan orang-orang yang dikasihi-Nya. Sampai selama-lamanya mereka akan terpelihara, tetapi anak cucu orang-orang fasik akan dilenyapkan. Orang-orang benar akan mewarisi negeri dan tinggal di sana senantiasa.` },
      { id: "inherit-land-ms-6", reference: "Mazmur 37:34", title: `Mewarisi Bumi — Wahyu Mazmur 37`, text: `Nantikanlah Tuhan dan tetap ikutilah jalan-Nya, maka Ia akan mengangkat engkau untuk mewarisi negeri, dan engkau akan melihat orang-orang fasik dilenyapkan.` },
      { id: "inherit-land-ms-7", reference: "Yesaya 57:13", title: `Mewarisi Bumi — Wahyu Mazmur 37`, text: `apabila engkau berteriak, biarlah berhala-berhalamu melepaskan engkau! Mereka semua akan ditiup angin, akan diterbangkan hembusan nafas. Tetapi orang yang berlindung kepada-Ku akan mewarisi negeri dan akan memiliki gunung-Ku yang kudus.` },
      { id: "inherit-land-ms-8", reference: "Matius 5:5", title: `Mewarisi Bumi — Wahyu Mazmur 37`, text: `Berbahagialah orang yang lemah lembut, karena mereka akan memiliki bumi.` },
    ]
  },
];
