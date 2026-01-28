const ORDER = ["3","4","5","6","7","8","9","10","J","Q","K","A","2"];
const RANK_VALUE = Object.fromEntries(ORDER.map((r, i) => [r, i]));

function sortByRank(cards) {
  return [...cards].sort((a, b) => RANK_VALUE[a.r] - RANK_VALUE[b.r]);
}

function classifyCombo(cards) {
  if (!cards || cards.length === 0) return { ok: false, reason: "EMPTY" };

  const c = sortByRank(cards);
  const n = c.length;

  const ranks = c.map(x => x.r);
  const uniq = [...new Set(ranks)];

  // SINGLE
  if (n === 1) return { ok: true, type: "SINGLE", rank: ranks[0], len: 1 };

  // PAIR / TRIPLE / QUAD
  if (uniq.length === 1) {
    if (n === 2) return { ok: true, type: "PAIR", rank: uniq[0], len: 2 };
    if (n === 3) return { ok: true, type: "TRIPLE", rank: uniq[0], len: 3 };
    if (n === 4) return { ok: true, type: "QUAD", rank: uniq[0], len: 4 };
    return { ok: false, reason: "INVALID_SET" };
  }

  // STRAIGHT (>=3)
  if (n >= 3) {
    // Check if combo is KA2 (not allowed)
    if (ranks.includes("K") && ranks.includes("A") && ranks.includes("2")) {
      return { ok: false, reason: "KA2_NOT_ALLOWED" };
    }

    // Try normal ORDER sequence first (3, 4, ..., A, 2)
    const vals = ranks.map(r => RANK_VALUE[r]);
    let ok = true;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[i - 1] + 1) {
        ok = false;
        break;
      }
    }

    if (ok) {
      return { ok: true, type: "STRAIGHT", rank: ranks[n - 1], len: n };
    }

    // Special case for A, 2, 3 sequence (A is before 2 in logical circular, but here we handle explicitly)
    // In Sâm Lốc, 2 can be at the start (2-3-4) or middle (A-2-3) or end (Q-K-A-2 is NO, but 10-J-Q-K-A is YES)
    // The user said: 234, A23, 2345 are OK.
    // Let's use a circular order for checking: Q, K, A, 2, 3, 4, 5...
    const CIRCULAR_ORDER = ["3","4","5","6","7","8","9","10","J","Q","K","A","2"];
    // Wait, the standard ORDER already has 2 at the end. 
    // If someone plays A-2-3, ranks would be ["A", "2", "3"] (after sorting by RANK_VALUE).
    // RANK_VALUE: A=11, 2=12, 3=0. This won't work with simple subtraction.
    
    // Custom check for Sâm Lốc straights:
    const SAM_STRAIGHT_ORDER = ["A","2","3","4","5","6","7","8","9","10","J","Q","K","A"];
    // But wait, the user said KA2 is NOT allowed.
    // Allowed: A-2-3-..., 2-3-4-..., 3-4-5-..., ..., J-Q-K-A.
    // Basically, any sequence from [A, 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A] is OK 
    // EXCEPT if it contains the transition K-A-2.
    // So A-2-3 is OK. 2-3-4 is OK. Q-K-A is OK.
    // K-A-2 is NO. Q-K-A-2 is NO.
    
    // Let's re-sort based on a sequence that allows A-2-3: [A, 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K]
    const STRAIGHT_ORDER = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
    const S_VAL = Object.fromEntries(STRAIGHT_ORDER.map((r, i) => [r, i]));
    
    const s_c = [...cards].sort((a, b) => S_VAL[a.r] - S_VAL[b.r]);
    const s_ranks = s_c.map(x => x.r);
    const s_vals = s_ranks.map(r => S_VAL[r]);
    
    let s_ok = true;
    for (let i = 1; i < s_vals.length; i++) {
      if (s_vals[i] !== s_vals[i - 1] + 1) {
        s_ok = false;
        break;
      }
    }
    
    if (s_ok) {
      // Check for KA2 one more time just in case (though STRAIGHT_ORDER doesn't have A after K)
      // Actually, STRAIGHT_ORDER has K at the end. So Q-K-A is not possible in this order.
      // We need to support BOTH [3...A] and [A, 2, 3...]
      return { ok: true, type: "STRAIGHT", rank: s_ranks[n - 1], len: n };
    }
    
    // Try standard order again for J-Q-K-A (which is not in STRAIGHT_ORDER)
    const alt_ok = ranks.every((r, i) => i === 0 || RANK_VALUE[r] === RANK_VALUE[ranks[i-1]] + 1);
    if (alt_ok) {
       // Check KA2
       if (ranks.includes("K") && ranks.includes("A") && ranks.includes("2")) return { ok: false, reason: "KA2_NOT_ALLOWED" };
       return { ok: true, type: "STRAIGHT", rank: ranks[n - 1], len: n };
    }

    return { ok: false, reason: "INVALID_STRAIGHT" };
  }

  // mặc định: INVALID (tự chặn 334, 4456, ...)
  return { ok: false, reason: "INVALID_COMBO" };
}

function canBeat(prev, next) {
  // bàn trống: đánh gì cũng được
  if (!prev) return true;

  // Tứ quý (QUAD) có thể chặn 1 con 2 hoặc đôi 2
  if (next.type === "QUAD") {
    if (prev.type === "SINGLE" && prev.rank === "2") return true;
    if (prev.type === "PAIR" && prev.rank === "2") return true;
    // Tứ quý lớn hơn tứ quý nhỏ
    if (prev.type === "QUAD") return RANK_VALUE[next.rank] > RANK_VALUE[prev.rank];
    return false;
  }

  // Nếu không phải tứ quý, phải cùng type
  if (prev.type !== next.type) return false;

  // straight phải cùng độ dài
  if (prev.type === "STRAIGHT" && prev.len !== next.len) return false;

  // so theo rank value (rank = lá đại diện / lá cao nhất với sảnh)
  return RANK_VALUE[next.rank] > RANK_VALUE[prev.rank];
}

module.exports = { classifyCombo, canBeat };
