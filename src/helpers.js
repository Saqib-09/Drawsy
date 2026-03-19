export const formatMMSS = (ms) => {
  const s  = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

export const formatSeconds = (ms) => Math.max(0, Math.floor(ms / 1000));

export const getCoordinates = (e, canvas) => {
  const rect = canvas.getBoundingClientRect();
  const pt   = e.touches ? e.touches[0] : e;
  return { x: pt.clientX - rect.left, y: pt.clientY - rect.top };
};

export const pickChoices = (pool, used, k = 3) => {
  const candidates = pool.filter(w => !used.includes(w));
  const base = candidates.length >= k ? candidates : pool;
  const arr  = [...base];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, k);
};

/** Levenshtein distance — for fuzzy "close guess" detection */
export const levenshtein = (a, b) => {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
};

export const isCloseGuess = (guess, answer) => {
  if (!guess || !answer) return false;
  const dist      = levenshtein(guess.toLowerCase(), answer.toLowerCase());
  const threshold = Math.max(1, Math.floor(answer.length / 4));
  return dist > 0 && dist <= threshold;
};

/**
 * Build the draw order for a game.
 *
 * FFA  → shuffle all player ids
 * Teams → interleave teams so they alternate:
 *   [red0, blue0, red1, blue1, ...]
 *   This way each "round" (full cycle) has each team drawing the same number of times.
 */
export const buildDrawOrder = (players, mode, teams) => {
  if (mode !== 'teams' || !teams?.length) {
    // FFA: shuffle
    const ids = players.map(p => p.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  }

  // Teams mode: interleave members of each team
  const teamMembers = teams.map(t =>
    (t.members || []).filter(uid => players.some(p => p.id === uid))
  );
  const maxLen = Math.max(...teamMembers.map(m => m.length));
  const order  = [];
  for (let i = 0; i < maxLen; i++) {
    teamMembers.forEach(members => { if (members[i]) order.push(members[i]); });
  }
  return order;
};

/** Simple debounce */
export const debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};
