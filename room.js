const { classifyCombo, canBeat } = require("./rules");
const { computeRoundScores } = require("./scoring");

const DECLARE_SECONDS = 15;
const SAM_PENALTY_EACH = 20;
const SAM_REWARD_EACH = 20;

function makeDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = ["3","4","5","6","7","8","9","10","J","Q","K","A","2"];
  const deck = [];
  for (const r of ranks) for (const s of suits) deck.push({ r, s, id: `${r}${s}` });
  return deck;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// thắng trắng tối giản (optional)
function isWhiteWin_TuQuy2(hand) {
  return hand.filter(c => c.r === "2").length === 4;
}
function isWhiteWin_10Straight(hand) {
  const c = classifyCombo(hand);
  return c.ok && c.type === "STRAIGHT" && c.len === 10;
}
function isWhiteWin_5Pairs(hand) {
  const m = {};
  for (const c of hand) m[c.r] = (m[c.r] || 0) + 1;
  return Object.values(m).filter(v => v === 2).length === 5;
}

function rankValue(r) {
  const ORDER = ["3","4","5","6","7","8","9","10","J","Q","K","A","2"];
  return ORDER.indexOf(r);
}

function highestSingleCardId(hand) {
  // trả về id lá cao nhất (so theo rank, nếu bằng rank thì so suit theo unicode cũng được)
  let best = null;
  for (const c of hand) {
    if (!best) best = c;
    else if (rankValue(c.r) > rankValue(best.r)) best = c;
  }
  return best ? best.id : null;
}

class Room {
  constructor(id, maxPlayers = 5) {
    this.id = id;
    this.maxPlayers = maxPlayers;

    this.players = []; // {id,name}
    this.hostId = null;

    this.phase = "LOBBY"; // LOBBY | DECLARE_SAM | PLAYING | ROUND_END
    this.started = false;

    this.turnIndex = 0;
    this.lastWinnerId = null;

    this.hands = {};     // pid -> cards[]
    this.points = {};    // pid -> total points

    this.playedAny = {}; // pid -> bool (cóng)

    // trick
    this.table = { cards: [], combo: null, holderId: null, holderName: "" };
    this.passed = new Set();

    // báo sâm
    this.declare = { deadline: 0, choices: {} };
    this.sam = {
      declaredBy: null,  // pid báo sâm
      active: false,
      failed: false,
      penaltyApplied: false,
      rewardApplied: false
    };

    // ====== BAO 1 SPECIAL RULE ======
    this.bao1 = {
      active: false,
      pid: null,        // người báo 1
      prevPid: null,    // người đánh ngay trước người báo 1
      offenderPid: null,
      violated: false,
      triggered: false  // để tránh áp dụng nhiều lần
    };

    this._lastTurnPid = null; // lưu người đánh trước lượt hiện tại
  }

  isFull() { return this.players.length >= this.maxPlayers; }
  getName(pid) { return this.players.find(p => p.id === pid)?.name || (pid ? pid.slice(0, 5) : ""); }
  get turnId() { return this.players[this.turnIndex]?.id || null; }

  addPlayer(pid, name) {
    if (this.players.some(p => p.id === pid)) return;
    if (this.isFull()) throw new Error("ROOM_FULL");
    const clean = (name || "").trim().replace(/\s+/g, " ").slice(0, 16) || pid.slice(0, 5);
    this.players.push({ id: pid, name: clean });
    if (!this.hostId) this.hostId = pid;
    if (this.points[pid] == null) this.points[pid] = 0;
    if (!this.hands[pid]) this.hands[pid] = [];
    if (this.playedAny[pid] == null) this.playedAny[pid] = false;
  }

  removePlayer(pid) {
    this.players = this.players.filter(p => p.id !== pid);
    delete this.hands[pid];
    delete this.playedAny[pid];
    this.passed.delete(pid);
    delete this.declare.choices[pid];

    if (this.hostId === pid) this.hostId = this.players[0]?.id || null;
    if (this.turnIndex >= this.players.length) this.turnIndex = 0;

    if (this.players.length < 2) this.newRound(true);
  }

  resetTrick() {
    this.table = { cards: [], combo: null, holderId: null, holderName: "" };
    this.passed.clear();
  }

  newRound(force = false) {
    this.phase = "LOBBY";
    this.started = false;
    this.turnIndex = 0;
    this.resetTrick();

    this.declare = { deadline: 0, choices: {} };
    this.sam = { declaredBy: null, active: false, failed: false, penaltyApplied: false, rewardApplied: false };

    this.bao1 = { active:false, pid:null, prevPid:null, offenderPid:null, violated:false, triggered:false };
    this._lastTurnPid = null;

    if (force) for (const p of this.players) this.hands[p.id] = [];
  }

  startGame() {
    if (this.started) return { ok: false, reason: "ALREADY_STARTED" };
    if (this.players.length < 2) return { ok: false, reason: "NEED_2_PLAYERS" };

    const deck = shuffle(makeDeck());
    const n = this.players.length;

    for (const p of this.players) {
      this.hands[p.id] = [];
      this.playedAny[p.id] = false;
    }
    this.resetTrick();

    // chia 10 lá
    for (let i = 0; i < 10; i++) {
      for (let k = 0; k < n; k++) {
        const pid = this.players[k].id;
        this.hands[pid].push(deck.pop());
      }
    }

    this.started = true;
    this.phase = "DECLARE_SAM";
    this.declare.deadline = Date.now() + DECLARE_SECONDS * 1000;
    this.declare.choices = {};

    this.sam = { declaredBy: null, active: false, failed: false, penaltyApplied: false, rewardApplied: false };
    this.bao1 = { active:false, pid:null, prevPid:null, offenderPid:null, violated:false, triggered:false };
    this._lastTurnPid = null;

    // Nếu có người thắng ván trước, người đó được quyền ưu tiên
    if (this.lastWinnerId) {
      const idx = this.players.findIndex(p => p.id === this.lastWinnerId);
      if (idx !== -1) {
        this.turnIndex = idx;
      } else {
        this.turnIndex = 0;
      }
    } else {
      this.turnIndex = 0;
    }

    // thắng trắng (nếu muốn)
    for (const p of this.players) {
      const hand = this.hands[p.id];
      if (isWhiteWin_TuQuy2(hand) || isWhiteWin_10Straight(hand) || isWhiteWin_5Pairs(hand)) {
        this.hands[p.id] = [];
        this.started = false;
        this.phase = "ROUND_END";
        this.lastWinnerId = p.id;
        return { ok: true, whiteWin: true, winnerId: p.id };
      }
    }

    return { ok: true };
  }

  declareSam(pid, flag) {
    if (this.phase !== "DECLARE_SAM") return { ok: false, reason: "NOT_DECLARE_PHASE" };
    if (!this.players.some(p => p.id === pid)) return { ok: false, reason: "NOT_IN_ROOM" };
    this.declare.choices[pid] = !!flag;
    return { ok: true };
  }

  tickDeclarePhase() {
    if (this.phase !== "DECLARE_SAM") return false;
    if (Date.now() < this.declare.deadline) return false;

    // chọn người báo sâm: người đầu tiên (theo thứ tự players) bấm true
    const samPid = this.players.find(p => this.declare.choices[p.id] === true)?.id || null;

    if (samPid) {
      this.sam.declaredBy = samPid;
      this.sam.active = true;
      this.turnIndex = this.players.findIndex(p => p.id === samPid);
      if (this.turnIndex < 0) this.turnIndex = 0;
    } else {
      // Nếu không ai báo sâm, lượt đánh vẫn giữ như lúc startGame thiết lập (người thắng ván trước)
    }

    this.phase = "PLAYING";
    return true;
  }

  pass(pid) {
    if (this.phase !== "PLAYING" || !this.started) return { ok: false, reason: "NOT_PLAYING" };
    if (pid !== this.turnId) return { ok: false, reason: "NOT_YOUR_TURN" };
    if (!this.table.combo) return { ok: false, reason: "CANNOT_PASS_ON_EMPTY" };

    this.passed.add(pid);
    this.advanceTurnSkippingPassed();

    // nếu mọi người trừ holder đã pass -> reset trick, lượt về holder
    const passedCount = [...this.passed].length;
    if (this.table.holderId && passedCount >= this.players.length - 1) {
      const holder = this.table.holderId;
      this.resetTrick();
      const idx = this.players.findIndex(p => p.id === holder);
      this.turnIndex = idx >= 0 ? idx : 0;
    }

    return { ok: true };
  }

  advanceTurnSkippingPassed() {
    if (!this.players.length) return;
    let tries = 0;
    do {
      this.turnIndex = (this.turnIndex + 1) % this.players.length;
      tries++;
      if (tries > this.players.length + 1) break;
    } while (this.passed.has(this.turnId));
  }

  applySamPenalty(systemMessages) {
    if (!this.sam.active || this.sam.penaltyApplied) return;
    const samPid = this.sam.declaredBy;
    if (!samPid) return;

    const nOthers = this.players.length - 1;
    const total = SAM_PENALTY_EACH * nOthers;

    this.points[samPid] -= total;
    for (const p of this.players) {
      if (p.id !== samPid) this.points[p.id] += SAM_PENALTY_EACH;
    }

    this.sam.penaltyApplied = true;
    systemMessages.push(`💥 BẮT SÂM: ${this.getName(samPid)} thua ngay → trả mỗi người ${SAM_PENALTY_EACH} điểm.`);
  }

  applySamReward(systemMessages) {
    if (!this.sam.active || this.sam.failed || this.sam.rewardApplied) return;
    const samPid = this.sam.declaredBy;
    if (!samPid) return;

    this.sam.rewardApplied = true;
    systemMessages.push(`🔥 THẮNG SÂM: ${this.getName(samPid)} thắng ván (mọi người bị tính cóng).`);
  }

  play(pid, cardIds) {
    const systemMessages = [];

    if (this.phase !== "PLAYING" || !this.started) return { ok: false, reason: "NOT_PLAYING" };
    if (pid !== this.turnId) return { ok: false, reason: "NOT_YOUR_TURN" };
    if (this.passed.has(pid)) return { ok: false, reason: "YOU_PASSED_THIS_TRICK" };

    const hand = this.hands[pid] || [];
    const set = new Set(cardIds);

    const chosen = hand.filter(c => set.has(c.id));
    if (chosen.length !== cardIds.length) return { ok: false, reason: "CARD_NOT_IN_HAND" };

    const combo = classifyCombo(chosen);
    if (!combo.ok) return { ok: false, reason: combo.reason || "INVALID_COMBO" };

    const prevCombo = this.table.combo;
    if (!canBeat(prevCombo, combo)) return { ok: false, reason: "CANNOT_BEAT_TABLE" };

    // ======= LUẬT BÁO 1 SPECIAL (ĐỀN BÀI) =======
    if (this.bao1.active && pid !== this.bao1.pid) {
      // Chỉ người chơi ngồi ngay trước người báo 1 mới bị áp dụng luật đền bài
      if (pid === this.bao1.prevPid) {
        // Chỉ xét khi người báo 1 đang chờ để được đánh (tức là họ chưa bị chặn ở vòng này)
        // Hoặc đơn giản là khi người ngồi trước đánh lá lẻ (SINGLE)
        if (combo.type === "SINGLE") {
          const highestId = highestSingleCardId(hand);
          // Nếu lá đánh ra không phải là lá mạnh nhất trong các lá lẻ có thể đánh
          if (chosen[0].id !== highestId) {
            this.bao1.violated = true;
            this.bao1.offenderPid = pid;
            systemMessages.push(`⚠️ CẢNH BÁO: ${this.getName(pid)} (người ngồi trước) không đánh lá cao nhất khi có người báo 1!`);
          }
        }
      }
    }

    // ======= LUẬT CHẶT 2 (PHẠT NGAY) =======
    if (prevCombo && prevCombo.type === "SINGLE" && prevCombo.rank === "2" && combo.type === "QUAD") {
      const victimId = this.table.holderId;
      if (victimId && victimId !== pid) {
        this.points[victimId] -= 5;
        this.points[pid] += 5;
        systemMessages.push(`🎯 ${this.getName(pid)} CHẶT 2 của ${this.getName(victimId)}! (+5 điểm)`);
      }
    }
    if (prevCombo && prevCombo.type === "PAIR" && prevCombo.rank === "2" && combo.type === "QUAD") {
      const victimId = this.table.holderId;
      if (victimId && victimId !== pid) {
        this.points[victimId] -= 10;
        this.points[pid] += 10;
        systemMessages.push(`🎯 ${this.getName(pid)} CHẶT ĐÔI 2 của ${this.getName(victimId)}! (+10 điểm)`);
      }
    }

    // ======= LUẬT BẮT SÂM (QUAN TRỌNG) =======
    // Nếu đang có báo sâm, và người báo sâm đang là holder của bàn,
    // mà người khác đánh đè lên được -> người báo sâm THUA NGAY, TRỪ ĐIỂM NGAY, KẾT THÚC VÁN
    if (this.sam.active && this.sam.declaredBy) {
      const samPid = this.sam.declaredBy;
      const prevHolder = this.table.holderId;

      if (prevHolder === samPid && pid !== samPid && this.table.combo) {
        this.sam.failed = true;
        this.applySamPenalty(systemMessages);

        // kết thúc ván ngay lập tức
        this.started = false;
        this.phase = "ROUND_END";

        systemMessages.push(`🏁 Ván kết thúc vì bắt sâm. Người bắt: ${this.getName(pid)}.`);

        // cập nhật bàn (cho UI thấy người bắt vừa đánh gì)
        this.table.cards = chosen.map(c => c.id);
        this.table.combo = combo;
        this.table.holderId = pid;
        this.table.holderName = this.getName(pid);

        return { ok: true, samCaught: true, loserId: samPid, catcherId: pid, systemMessages };
      }
    }
    // ========================================

    // apply play
    this.playedAny[pid] = true;
    this.hands[pid] = hand.filter(c => !set.has(c.id));

    // lưu người vừa đánh (để biết ai đánh ngay trước)
    const prevTurn = this._lastTurnPid; // người đánh trước đó
    this._lastTurnPid = pid;

    // nếu người này còn 1 lá => kích hoạt báo 1 rule
    if ((this.hands[pid]?.length || 0) === 1) {
      this.bao1.active = true;
      this.bao1.pid = pid;
      this.bao1.prevPid = prevTurn; // người đánh ngay trước họ
      this.bao1.violated = false;
      this.bao1.offenderPid = null;
      this.bao1.triggered = false;
      systemMessages.push(`📢 ${this.getName(pid)} BÁO 1!`);
    }

    this.table.cards = chosen.map(c => c.id);
    this.table.combo = combo;
    this.table.holderId = pid;
    this.table.holderName = this.getName(pid);

    // nếu hết bài -> win
    if ((this.hands[pid]?.length || 0) === 0) {
      this.started = false;
      this.phase = "ROUND_END";
      this.lastWinnerId = pid;

      // nếu người thắng chính là người báo 1, và có vi phạm => bật cờ để scoring xử lý
      if (this.bao1.active && this.bao1.pid === pid && this.bao1.violated && this.bao1.offenderPid) {
        this.bao1.triggered = true; // khóa lại
      }

      // nếu người thắng là người báo sâm và chưa bị bắt -> thưởng
      if (this.sam.active && this.sam.declaredBy === pid && !this.sam.failed) {
        this.applySamReward(systemMessages);
      }

      return { ok: true, win: true, winnerId: pid, systemMessages };
    }

    if (this.hands[pid].length === 1) {
      systemMessages.push(`📢 ${this.getName(pid)} báo 1!`);
    }

    this.advanceTurnSkippingPassed();
    return { ok: true, win: false, systemMessages };
  }

  finishAndScore() {
    const { delta, winnerId } = computeRoundScores({
      players: this.players,
      hands: this.hands,
      playedAny: this.playedAny,

      // ===== thêm payload cho luật báo 1 =====
      bao1: {
        active: this.bao1.active,
        winnerIsBao1: this.bao1.active && this.bao1.pid,
        pid: this.bao1.pid,
        violated: this.bao1.violated,
        offenderPid: this.bao1.offenderPid,
        triggered: this.bao1.triggered
      },
      sam: {
        active: this.sam.active,
        declaredBy: this.sam.declaredBy,
        failed: this.sam.failed
      }
    });

    for (const pid of Object.keys(delta)) {
      this.points[pid] = (this.points[pid] || 0) + delta[pid];
    }
    return winnerId;
  }

  snapshot() {
    return {
      id: this.id,
      hostId: this.hostId,
      hostName: this.getName(this.hostId),
      started: this.started,
      phase: this.phase,
      turnId: this.turnId,
      turnName: this.getName(this.turnId),

      players: this.players.map(p => ({ 
        id: p.id, 
        name: p.name,
        cardCount: this.hands[p.id]?.length || 0
      })),
      points: this.points,

      table: {
        cards: this.table.cards,
        type: this.table.combo ? this.table.combo.type : "",
        holderName: this.table.holderName || ""
      },

      declare: {
        deadline: this.declare.deadline,
        choices: this.declare.choices
      },

      sam: {
        declaredBy: this.sam.declaredBy,
        active: this.sam.active,
        failed: this.sam.failed
      }
    };
  }
}

module.exports = { Room };
