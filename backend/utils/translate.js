// Translation utility.
//
// Uses the MyMemory Translation API (https://mymemory.translated.net) — a free,
// no-API-key-required REST translation service. Good enough for a document
// translation feature without requiring paid credentials from the user.
//
// If you want higher quality/volume translation later, swap translateChunk()
// to call Google Cloud Translate / DeepL / Azure Translator instead - the rest
// of this module (HTML-tag preservation, chunking, document translation) stays
// the same either way.

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'bn', name: 'Bengali' },
  { code: 'tr', name: 'Turkish' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
  { code: 'pl', name: 'Polish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'cs', name: 'Czech' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'da', name: 'Danish' },
  { code: 'no', name: 'Norwegian' },
];

const MAX_CHUNK_LENGTH = 480; // MyMemory works best comfortably under 500 chars per request
const MAX_CONCURRENT_REQUESTS = 4;

function isSupportedLanguage(code) {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

// Translate a single block of plain text via MyMemory, splitting on sentence
// boundaries so no single request exceeds MAX_CHUNK_LENGTH.
async function translateText(text, targetLang, sourceLang = 'en') {
  if (!text || !text.trim()) return text;

  const chunks = splitIntoChunks(text, MAX_CHUNK_LENGTH);
  const translatedChunks = await mapWithConcurrency(chunks, MAX_CONCURRENT_REQUESTS, (chunk) =>
    translateChunk(chunk, sourceLang, targetLang)
  );
  return translatedChunks.join(' ');
}

function splitIntoChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const sentences = text.match(/[^.!?]+[.!?]*\s*|\S+\s*/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length > maxLen && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function translateChunk(text, sourceLang, targetLang) {
  try {
    const langpair = `${sourceLang}|${targetLang}`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Translation request failed with status ${response.status}`);
      return text; // fall back to original text rather than failing the whole document
    }

    const data = await response.json();
    const translated = data?.responseData?.translatedText;

    // MyMemory returns an error-ish string in some quota/failure cases instead of throwing
    if (!translated || data.responseStatus >= 400) {
      return text;
    }
    return translated;
  } catch (error) {
    console.error('Translation chunk failed:', error.message);
    return text; // graceful degradation - keep original text for this piece
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// Translate an HTML document body while preserving tags/structure.
// Splits the HTML into tag tokens and text tokens, translates only the text
// tokens (skipping ones that are empty/whitespace), and reassembles.
// De-duplicates identical text segments so repeated headings/labels only cost
// one API call.
async function translateHtml(html, targetLang, sourceLang = 'en') {
  if (!html || !html.trim()) return html;

  const tokens = html.split(/(<[^>]+>)/g); // keep tags as their own tokens
  const uniqueTexts = new Set();

  tokens.forEach((token) => {
    if (!token.startsWith('<') && token.trim()) {
      uniqueTexts.add(token);
    }
  });

  const translationMap = new Map();
  const uniqueList = Array.from(uniqueTexts);

  const translated = await mapWithConcurrency(uniqueList, MAX_CONCURRENT_REQUESTS, (text) =>
    translateText(text, targetLang, sourceLang)
  );
  uniqueList.forEach((text, i) => translationMap.set(text, translated[i]));

  return tokens
    .map((token) => {
      if (!token.startsWith('<') && token.trim()) {
        return translationMap.get(token) ?? token;
      }
      return token;
    })
    .join('');
}

module.exports = {
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  translateText,
  translateHtml,
};
