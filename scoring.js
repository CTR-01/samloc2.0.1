function computeRoundScores({ players, hands, playedAny, bao1, sam }) {
  // Winner: người có 0 lá
  let winnerId = null;
  for (const p of players) {
    if ((hands[p.id] || []).length === 0) {
      winnerId = p.id;
      break;
    }
  }
  if (!winnerId) winnerId = players[0]?.id || null;

  const delta = {};
  for (const p of players) delta[p.id] = 0;

  // Nếu thắng sâm -> mọi người khác bị tính cóng (20 lá)
  const isSamWin = sam && sam.active && sam.declaredBy === winnerId && !sam.failed;

  // tính loss từng người (trừ winner)
  const losses = {}; // pid -> số điểm bị trừ (dương)
  let pot = 0;

  for (const p of players) {
    if (p.id === winnerId) continue;

    const hand = hands[p.id] || [];
    let loss = 0;

    if (isSamWin) {
      loss = 20; // Thắng sâm: mặc định tính 20 lá (cóng)
    } else {
      loss = hand.length;
      // con 2 còn lại: +2 (tức mỗi 2 = 3 điểm tổng)
      const count2 = hand.filter(c => c.r === "2").length;
      loss += 2 * count2;
      // cóng: phạt thêm 10 (tổng thành 20 nếu hand=10)
      if (!playedAny[p.id]) loss += 10;
    }

    losses[p.id] = loss;
    pot += loss;
  }

  // ===== LUẬT PHẠT BÁO 1: offender gánh toàn bộ pot =====
  const applyBao1Penalty =
    bao1 &&
    bao1.triggered &&
    bao1.violated &&
    bao1.offenderPid &&
    winnerId === bao1.pid;

  if (applyBao1Penalty) {
    // winner ăn pot, nhưng chỉ offender trả
    for (const p of players) {
      delta[p.id] = 0;
    }
    delta[winnerId] = pot;
    delta[bao1.offenderPid] = -pot;
    return { delta, winnerId };
  }

  // ===== bình thường: ai thua trả phần của mình, winner ăn pot =====
  for (const pid of Object.keys(losses)) {
    delta[pid] -= losses[pid];
  }
  if (winnerId) delta[winnerId] += pot;

  return { delta, winnerId };
}

module.exports = { computeRoundScores };
