import fs from 'fs';
import path from 'path';
import readline from 'readline';

let shortPhrases: Record<string, string[]> = {};   // For pronunciation (A1-C2)
let longTexts:   Record<string, string[]> = {};   // For reading / correction / roleplay

// Since loader and JSONL files are in the SAME folder, we can do this:
const DATA_DIR = __dirname;

async function loadDatasets() {
  if (Object.keys(shortPhrases).length > 0) return; // already loaded

  console.log('Loading CEFR datasets from:', DATA_DIR);

  // Load short sentences for pronunciation
  await loadJsonlFile(
    path.join(DATA_DIR, 'readme_fr.json'), 
    shortPhrases, 
    8,   // min length
    140  // max length
  );

  // Load longer texts (if you have the file)
  await loadJsonlFile(
    path.join(DATA_DIR, 'kwiqiz_fr.jsonl'), 
    longTexts, 
    50, 
    800
  );

  console.log('✅ CEFR datasets loaded successfully');
  console.log('Short phrases per level:', 
    Object.keys(shortPhrases).map(k => `${k}: ${shortPhrases[k].length}`)
  );
  console.log('Long texts per level:', 
    Object.keys(longTexts).map(k => `${k}: ${longTexts[k].length}`)
  );
}

async function loadJsonlFile(
  filePath: string, 
  target: Record<string, string[]>, 
  minLen: number, 
  maxLen: number
) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: File not found → ${filePath}`);
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf-8').trim();

  let items: any[] = [];

  try {
    // Try JSON array first
    if (raw.startsWith('[')) {
      items = JSON.parse(raw);
    } else {
      // Fallback: JSONL
      items = raw.split('\n').map(line => JSON.parse(line));
    }
  } catch (err) {
    console.error('❌ Failed to parse dataset:', err);
    return;
  }

  for (const item of items) {
    const level = (item.cefr_level || item.level || '').toUpperCase().trim();
    const text = (item.text || '').trim();

    if (!level || !text) continue;

    if (text.length >= minLen && text.length <= maxLen) {
      if (!target[level]) target[level] = [];
      target[level].push(text);
    }
  }

  console.log(`Loaded ${items.length} items from ${path.basename(filePath)}`);
}

// Get random short phrases for pronunciation mode
export async function getRandomPronunciationPhrases(level: string, count = 25): Promise<string[]> {
  await loadDatasets();

  const phrases = shortPhrases[level.toUpperCase()] || [];
  
  if (phrases.length === 0) {
    console.warn(`No phrases found for level ${level}, using fallback`);
    return ["Bonjour ! Comment allez-vous aujourd'hui ?"];
  }

  // Shuffle and take requested count
  const shuffled = [...phrases].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// Get longer texts (useful for correction / reading practice)
export async function getLongerTexts(level: string, count = 3): Promise<string[]> {
  await loadDatasets();
  const texts = longTexts[level.toUpperCase()] || [];
  const shuffled = [...texts].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}