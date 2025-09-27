// data.js – Laden, Topics, adaptive buildQuestion, Wort-Stats, Hardest-List
export async function loadWords(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const entries = Array.isArray(json.entries) ? json.entries : [];
  // Normalisieren: lower-case 'en' zur ID-Nutzung
  entries.forEach(e => {
    e.en = String(e.en || "").trim();
    e.de = String(e.de || "").trim();
    e.topic = String(e.topic || "Misc").trim();
    e.hint = e.hint ?? "";
  });
  return { topics: json.topics || [], entries };
}

export function getTopics(pkg) {
  if (!pkg?.entries) return [];
  const set = new Set();
  pkg.entries.forEach(e => set.add(e.topic || "Misc"));
  return Array.from(set);
}

/* ---------- Wort-Stats in localStorage ---------- */
function wordKey(topic, en) {
  return `vocabxr:word:${topic || "All"}:${(en || "").toLowerCase()}`;
}

export function getWordStats(topic, en) {
  try {
    const raw = localStorage.getItem(wordKey(topic, en));
    return raw ? JSON.parse(raw) : { seen: 0, correct: 0, wrong: 0, streakWord: 0, lastSeen: null };
  } catch {
    return { seen: 0, correct: 0, wrong: 0, streakWord: 0, lastSeen: null };
  }
}

export function updateWordStats(topic, en, wasCorrect) {
  const prev = getWordStats(topic, en);
  const nowIso = new Date().toISOString();
  const next = {
    seen: prev.seen + 1,
    correct: prev.correct + (wasCorrect ? 1 : 0),
    wrong: prev.wrong + (wasCorrect ? 0 : 1),
    streakWord: wasCorrect ? (prev.streakWord + 1) : 0,
    lastSeen: nowIso
  };
  try { localStorage.setItem(wordKey(topic, en), JSON.stringify(next)); } catch {}
  return next;
}

function difficultyFor(topic, en) {
  const s = getWordStats(topic, en);
  // simple difficulty: 1 + wrong - 0.5*correct; Bonus, wenn zuletzt falsch
  const base = 1 + s.wrong - 0.5 * s.correct;
  const recentPenalty = (s.streakWord === 0 && s.seen > 0) ? 0.5 : 0.0;
  // clamp
  return Math.max(0.5, Math.min(4.0, base + recentPenalty));
}

/* ---------- Hilfsfunktionen ---------- */
function listByTopic(pkg, topic) {
  if (!pkg?.entries) return [];
  if (!topic) return pkg.entries;
  return pkg.entries.filter(e => e.topic === topic);
}

function weightedSample(pool, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return pool[Math.floor(Math.random() * pool.length)];
  let r = Math.random() * sum;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/* ---------- Öffentlich: schwerste Wörter ---------- */
export function getHardestWords(pkg, topic, count = 3) {
  const pool = listByTopic(pkg, topic);
  const scored = pool.map(e => ({
    en: e.en,
    de: e.de,
    topic: e.topic,
    diff: difficultyFor(e.topic, e.en)
  }));
  scored.sort((a, b) => b.diff - a.diff);
  return scored.slice(0, Math.max(0, count));
}

/* ---------- buildQuestion (adaptiv & Pools) ---------- */
export function buildQuestion(pkg, opts = {}) {
  const topic = opts.topic || null;
  const maxOptions = Math.max(2, opts.maxOptions || 4);
  const onlyPool = Array.isArray(opts.onlyPool) ? opts.onlyPool.map(s => s.toLowerCase()) : null;
  const adaptive = !!opts.adaptive;
  const weightFactor = Number.isFinite(opts.weightFactor) ? opts.weightFactor : 1.2;

  let pool = listByTopic(pkg, topic);
  if (!pool.length) return null;

  // Nur-IDs/Pool (z. B. Retry oder Review-Only)
  if (onlyPool && onlyPool.length) {
    pool = pool.filter(e => onlyPool.includes((e.en || "").toLowerCase()));
    if (!pool.length) return null;
  }

  // Prompt wählen
  let promptEntry = null;
  if (adaptive && !onlyPool) {
    const weights = pool.map(e => {
      const d = difficultyFor(e.topic, e.en);
      // Gewicht >= 0.2, linear verstärkt
      return Math.max(0.2, 1 + weightFactor * (d - 1));
    });
    promptEntry = weightedSample(pool, weights);
  } else {
    promptEntry = pool[Math.floor(Math.random() * pool.length)];
  }

  // Optionen zusammenstellen (Prompt + Distraktoren aus demselben Topic falls möglich)
  const others = pool.filter(e => e !== promptEntry);
  const optsPool = others.length ? others : listByTopic(pkg, null).filter(e => e !== promptEntry);
  // random mischen
  const shuffled = shuffle(optsPool).slice(0, Math.max(0, maxOptions - 1));
  const final = [promptEntry, ...shuffled];
  const optionLabels = shuffle(final.map(e => e.en));
  const correctIndex = optionLabels.findIndex(l => l === promptEntry.en);

  return {
    prompt: { en: promptEntry.en, de: promptEntry.de, hint: promptEntry.hint, topic: promptEntry.topic },
    options: optionLabels.map(en => ({ en })),
    correctIndex
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
