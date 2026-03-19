/**
 * Formats milliseconds into MM:SS format.
 */
export const formatMMSS = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

export const formatSeconds = (ms) => {
  return Math.max(0, Math.floor(ms / 1000));
};

/**
 * Gets the coordinates of a pointer event relative to a canvas.
 */
export const getCoordinates = (e, canvas) => {
  const rect = canvas.getBoundingClientRect();
  const pt = e.touches ? e.touches[0] : e;
  return { x: pt.clientX - rect.left, y: pt.clientY - rect.top };
};

/**
 * Picks a specified number of unique words from a pool, avoiding used words.
 * When difficulty is provided, picks one word from each tier if possible.
 */
export const pickChoices = (pool, used, k = 3, byDifficulty = null) => {
  if (byDifficulty && k === 3) {
    const pick = (arr) => {
      const candidates = arr.filter(w => !used.includes(w));
      const base = candidates.length ? candidates : arr;
      return base[Math.floor(Math.random() * base.length)];
    };
    const easy   = pick(byDifficulty.easy);
    const medium = pick(byDifficulty.medium);
    const hard   = pick(byDifficulty.hard);
    return [easy, medium, hard].filter(Boolean);
  }

  const candidates = pool.filter(w => !used.includes(w));
  const base = candidates.length >= k ? candidates : pool;
  const arr = [...base];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, k);
};

/**
 * Levenshtein distance between two strings.
 * Used for fuzzy "close guess" detection.
 */
export const levenshtein = (a, b) => {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
};

/**
 * Returns a "closeness" string for a guess vs. the correct word.
 * null = not close, 'warm' = 1-2 chars off, 'hot' = same first letter and length
 */
export const getGuessCloseness = (guess, answer) => {
  if (!guess || !answer) return null;
  const dist = levenshtein(guess.toLowerCase(), answer.toLowerCase());
  const threshold = Math.max(1, Math.floor(answer.length / 4));
  if (dist <= threshold && dist > 0) return 'warm';
  return null;
};

/**
 * Returns word-length bonus multiplier for scoring.
 * Short words (≤4) = 0.8x, medium (5-7) = 1x, long (8+) = 1.2x
 */
export const wordLengthMultiplier = (word) => {
  const len = (word || '').length;
  if (len <= 4) return 0.8;
  if (len <= 7) return 1.0;
  return 1.2;
};

/**
 * Simple debounce utility.
 */
export const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};
