// Languages supported by Gemini 3.5 Live Translate (BCP-47 code → display name + native name).
export const LANGUAGES = [
  ['af', 'Afrikaans', 'Afrikaans'],
  ['ak', 'Akan', 'Akan'],
  ['sq', 'Albanian', 'Shqip'],
  ['am', 'Amharic', 'አማርኛ'],
  ['ar', 'Arabic', 'العربية'],
  ['hy', 'Armenian', 'Հայերեն'],
  ['az', 'Azerbaijani', 'Azərbaycan'],
  ['eu', 'Basque', 'Euskara'],
  ['be', 'Belarusian', 'Беларуская'],
  ['bn', 'Bengali', 'বাংলা'],
  ['bg', 'Bulgarian', 'Български'],
  ['my', 'Burmese', 'မြန်မာ'],
  ['ca', 'Catalan', 'Català'],
  ['zh-Hans', 'Chinese (Simplified)', '简体中文'],
  ['zh-Hant', 'Chinese (Traditional)', '繁體中文'],
  ['hr', 'Croatian', 'Hrvatski'],
  ['cs', 'Czech', 'Čeština'],
  ['da', 'Danish', 'Dansk'],
  ['nl', 'Dutch', 'Nederlands'],
  ['en', 'English', 'English'],
  ['et', 'Estonian', 'Eesti'],
  ['fil', 'Filipino', 'Filipino'],
  ['fi', 'Finnish', 'Suomi'],
  ['fr', 'French', 'Français'],
  ['gl', 'Galician', 'Galego'],
  ['ka', 'Georgian', 'ქართული'],
  ['de', 'German', 'Deutsch'],
  ['el', 'Greek', 'Ελληνικά'],
  ['gu', 'Gujarati', 'ગુજરાતી'],
  ['ha', 'Hausa', 'Hausa'],
  ['he', 'Hebrew', 'עברית'],
  ['hi', 'Hindi', 'हिन्दी'],
  ['hu', 'Hungarian', 'Magyar'],
  ['is', 'Icelandic', 'Íslenska'],
  ['id', 'Indonesian', 'Bahasa Indonesia'],
  ['it', 'Italian', 'Italiano'],
  ['ja', 'Japanese', '日本語'],
  ['jv', 'Javanese', 'Basa Jawa'],
  ['kn', 'Kannada', 'ಕನ್ನಡ'],
  ['kk', 'Kazakh', 'Қазақ'],
  ['km', 'Khmer', 'ខ្មែរ'],
  ['rw', 'Kinyarwanda', 'Ikinyarwanda'],
  ['ko', 'Korean', '한국어'],
  ['lo', 'Lao', 'ລາວ'],
  ['lv', 'Latvian', 'Latviešu'],
  ['lt', 'Lithuanian', 'Lietuvių'],
  ['mk', 'Macedonian', 'Македонски'],
  ['ms', 'Malay', 'Bahasa Melayu'],
  ['ml', 'Malayalam', 'മലയാളം'],
  ['mr', 'Marathi', 'मराठी'],
  ['mn', 'Mongolian', 'Монгол'],
  ['ne', 'Nepali', 'नेपाली'],
  ['nb', 'Norwegian', 'Norsk'],
  ['fa', 'Persian', 'فارسی'],
  ['pl', 'Polish', 'Polski'],
  ['pt-BR', 'Portuguese (Brazil)', 'Português (Brasil)'],
  ['pt-PT', 'Portuguese (Portugal)', 'Português (Portugal)'],
  ['pa', 'Punjabi', 'ਪੰਜਾਬੀ'],
  ['ro', 'Romanian', 'Română'],
  ['ru', 'Russian', 'Русский'],
  ['sr', 'Serbian', 'Српски'],
  ['sd', 'Sindhi', 'سنڌي'],
  ['si', 'Sinhala', 'සිංහල'],
  ['sk', 'Slovak', 'Slovenčina'],
  ['sl', 'Slovenian', 'Slovenščina'],
  ['es', 'Spanish', 'Español'],
  ['su', 'Sundanese', 'Basa Sunda'],
  ['sw', 'Swahili', 'Kiswahili'],
  ['sv', 'Swedish', 'Svenska'],
  ['ta', 'Tamil', 'தமிழ்'],
  ['te', 'Telugu', 'తెలుగు'],
  ['th', 'Thai', 'ไทย'],
  ['tr', 'Turkish', 'Türkçe'],
  ['uk', 'Ukrainian', 'Українська'],
  ['ur', 'Urdu', 'اردو'],
  ['uz', 'Uzbek', 'Oʻzbek'],
  ['vi', 'Vietnamese', 'Tiếng Việt'],
  ['zu', 'Zulu', 'isiZulu'],
];

const byCode = new Map(LANGUAGES.map(([code, name, native]) => [code.toLowerCase(), { code, name, native }]));

/** Resolve a (possibly regional) BCP-47 code such as "es-ES" to a display name. */
export function languageName(code) {
  if (!code) return '';
  const c = code.toLowerCase();
  const hit = byCode.get(c) || byCode.get(c.split('-')[0]);
  if (hit) return hit.name;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

export const RTL = new Set(['ar', 'he', 'fa', 'ur', 'sd']);
export const isRtl = (code) => RTL.has(String(code || '').split('-')[0].toLowerCase());

/** Best guess at the user's language from the browser, constrained to supported codes. */
export function guessBrowserLanguage() {
  for (const raw of navigator.languages || [navigator.language || 'en']) {
    const l = raw.toLowerCase();
    if (l.startsWith('zh')) return /tw|hk|hant/.test(l) ? 'zh-Hant' : 'zh-Hans';
    if (l.startsWith('pt')) return l.includes('pt-pt') ? 'pt-PT' : 'pt-BR';
    if (l === 'no' || l.startsWith('nn') || l.startsWith('nb')) return 'nb';
    if (l.startsWith('tl')) return 'fil';
    const base = l.split('-')[0];
    if (byCode.has(base)) return byCode.get(base).code;
  }
  return 'en';
}
