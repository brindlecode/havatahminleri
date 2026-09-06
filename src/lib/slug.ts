/**
 * URL slug generation for Turkish place names.
 *
 * Why this is not a one-liner: JavaScript's `toLowerCase()` is locale-agnostic
 * and lowercases U+0130 (İ, "capital I with dot above") to the TWO code points
 * "i" + U+0307 (combining dot above). A naive
 *
 *     text.toLowerCase().replace(/[^a-z0-9]+/g, '-')
 *
 * therefore turns "İzmit" into "i-zmit", because the combining dot is not in
 * [a-z0-9] and becomes a separator. The same happens to İnegöl, İskenderun,
 * İpsala, İznik, İspir, İliç, İscehisar and every other name starting with İ.
 *
 * The fix is to fold every Turkish-specific letter to its ASCII equivalent
 * BEFORE lowercasing, then strip any remaining combining marks via NFD so no
 * unexpected code point can survive into the separator pass.
 */

/** Turkish (and Turkish-adjacent) letters folded to ASCII, applied case-sensitively. */
const TURKISH_FOLD: Record<string, string> = {
  // Dotted / dotless i - the whole reason this module exists.
  'İ': 'i', // U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE
  'I': 'i', // U+0049 - Turkish dotless capital I
  'ı': 'i', // U+0131 LATIN SMALL LETTER DOTLESS I
  'i': 'i',
  'Ç': 'c', 'ç': 'c',
  'Ğ': 'g', 'ğ': 'g',
  'Ö': 'o', 'ö': 'o',
  'Ş': 's', 'ş': 's',
  'Ü': 'u', 'ü': 'u',
  // Circumflex vowels used in Turkish loanwords (Hakkâri, Şehitkâmil, İnönü...)
  'Â': 'a', 'â': 'a',
  'Î': 'i', 'î': 'i',
  'Û': 'u', 'û': 'u',
};

/**
 * Fold Turkish letters to ASCII without relying on locale-aware case mapping.
 */
export function foldTurkish(text: string): string {
  let out = '';
  for (const ch of text) {
    out += TURKISH_FOLD[ch] ?? ch;
  }
  return out;
}

/**
 * Build a URL-safe slug from a Turkish place name.
 *
 *   slugify('İzmit')      === 'izmit'
 *   slugify('İnegöl')     === 'inegol'
 *   slugify('İskenderun') === 'iskenderun'
 *   slugify('Iğdır')      === 'igdir'
 *   slugify('Şişli')      === 'sisli'
 *   slugify('Çeşme')      === 'cesme'
 *   slugify('Gölcük')     === 'golcuk'
 */
export function slugify(text: string): string {
  return foldTurkish(text)
    // Decompose so any leftover accent becomes a separate combining mark...
    .normalize('NFD')
    // ...and drop the combining marks instead of turning them into separators.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * True when a slug shows the "i-" corruption produced by the old
 * lowercase-before-folding implementation (e.g. "i-zmit", "i-negol").
 */
export function isLegacyDottedISlug(slug: string): boolean {
  return /^i-[a-z]/.test(slug);
}
