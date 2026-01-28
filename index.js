const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const { Room } = require("./room");

const PORT = process.env.PORT || 5000;

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = new Map(); // roomId -> Room
const declareTimers = new Map(); // roomId -> timeoutId

function makeRoomCode() {
  // 4 ký tự số cho dễ nhập
  return String(Math.floor(1000 + Math.random() * 9000));
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Room(roomId, 5));
  return rooms.get(roomId);
}

function emitRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // gửi snapshot chung cho cả phòng
  io.to(roomId).emit("room_update", room.snapshot());

  // gửi bài riêng cho từng người
  for (const p of room.players) {
    io.to(p.id).emit("hand", room.hands[p.id] || []);
  }
}

function logRoom(roomId, msg) {
  io.to(roomId).emit("log", msg);
}

function clearDeclareTimer(roomId) {
  const t = declareTimers.get(roomId);
  if (t) clearTimeout(t);
  declareTimers.delete(roomId);
}

function scheduleDeclareTick(roomId) {
  clearDeclareTimer(roomId);
  const room = rooms.get(roomId);
  if (!room) return;

  const ms = Math.max(0, room.declare.deadline - Date.now());
  const t = setTimeout(() => {
    const changed = room.tickDeclarePhase();
    if (changed) {
      logRoom(roomId, `⏱️ Hết giờ báo sâm. Vào giai đoạn chơi.`);
      emitRoom(roomId);
    }
  }, ms + 10);

  declareTimers.set(roomId, t);
}

io.on("connection", (socket) => {
  socket.data.roomId = null;
  socket.data.name = null;

  socket.on("create_room", ({ name }) => {
    const clean = String(name || "").trim().slice(0, 16);
    if (!clean) return socket.emit("error_msg", "Thiếu tên.");

    let code = makeRoomCode();
    while (rooms.has(code)) code = makeRoomCode();

    const room = getOrCreateRoom(code);
    room.addPlayer(socket.id, clean);

    socket.data.roomId = code;
    socket.data.name = clean;

    socket.join(code);

    logRoom(code, `✅ ${clean} tạo phòng ${code}.`);
    emitRoom(code);
  });

  socket.on("join_room", ({ name, roomId }) => {
    const clean = String(name || "").trim().slice(0, 16);
    const rid = String(roomId || "").trim();
    if (!clean || !rid) return socket.emit("error_msg", "Thiếu tên hoặc mã phòng.");

    const room = rooms.get(rid);
    if (!room) return socket.emit("error_msg", "Phòng không tồn tại.");

    try {
      room.addPlayer(socket.id, clean);
    } catch (e) {
      return socket.emit("error_msg", e.message || "Không vào được phòng.");
    }

    socket.data.roomId = rid;
    socket.data.name = clean;

    socket.join(rid);

    logRoom(rid, `➕ ${clean} vào phòng.`);
    emitRoom(rid);
  });

  socket.on("leave_room", () => {
    const rid = socket.data.roomId;
    if (!rid) return;

    const room = rooms.get(rid);
    if (room) {
      const nm = socket.data.name || socket.id.slice(0, 5);
      room.removePlayer(socket.id);
      logRoom(rid, `👋 ${nm} rời phòng.`);
      emitRoom(rid);

      if (room.players.length === 0) {
        clearDeclareTimer(rid);
        rooms.delete(rid);
      }
    }

    socket.leave(rid);
    socket.data.roomId = null;
    socket.data.name = null;
  });

  socket.on("start_game", () => {
    const rid = socket.data.roomId;
    if (!rid) return;

    const room = rooms.get(rid);
    if (!room) return;

    if (room.hostId !== socket.id) return socket.emit("error_msg", "Chỉ host mới được bắt đầu.");

    const res = room.startGame();
    if (!res.ok) return socket.emit("error_msg", res.reason || "Không start được.");

    logRoom(rid, `🎮 Bắt đầu ván mới. 15s để báo sâm.`);
    emitRoom(rid);
    scheduleDeclareTick(rid);
  });

  socket.on("declare_sam", ({ flag }) => {
    const rid = socket.data.roomId;
    if (!rid) return;

    const room = rooms.get(rid);
    if (!room) return;

    const res = room.declareSam(socket.id, !!flag);
    if (!res.ok) return socket.emit("error_msg", res.reason || "Không báo được.");

    const nm = room.getName(socket.id);
    logRoom(rid, `📣 ${nm}: ${flag ? "BÁO SÂM" : "KHÔNG BÁO"}`);
    emitRoom(rid);
  });

  socket.on("pass", () => {
    const rid = socket.data.roomId;
    if (!rid) return;

    const room = rooms.get(rid);
    if (!room) return;

    const res = room.pass(socket.id);
    if (!res.ok) return socket.emit("error_msg", res.reason || "Không bỏ được.");

    emitRoom(rid);
  });

  socket.on("play_cards", ({ cardIds }) => {
    const rid = socket.data.roomId;
    if (!rid) return;

    const room = rooms.get(rid);
    if (!room) return;

    const res = room.play(socket.id, Array.isArray(cardIds) ? cardIds : []);
    if (!res.ok) return socket.emit("error_msg", res.reason || "Không đánh được.");

    // system messages
    for (const m of res.systemMessages || []) logRoom(rid, m);

    // Nếu bắt sâm -> kết thúc ván ngay, không tính score lá
    if (res.samCaught) {
      logRoom(rid, `🏁 Kết thúc ván (bắt sâm).`);
      emitRoom(rid);
      return;
    }

    // Nếu có người thắng bình thường -> tính điểm cuối ván
    if (res.win) {
      const winnerId = room.finishAndScore();
      logRoom(rid, `🏆 ${room.getName(winnerId)} thắng ván.`);
      emitRoom(rid);
      return;
    }

    emitRoom(rid);
  });

  socket.on("new_round", () => {
    const rid = socket.data.roomId;
    if (!rid) return;

    const room = rooms.get(rid);
    if (!room) return;

    if (room.hostId !== socket.id) return socket.emit("error_msg", "Chỉ host mới được ván mới.");
    room.newRound(false);
    clearDeclareTimer(rid);
    logRoom(rid, `🔁 Reset về lobby.`);
    emitRoom(rid);
  });

  socket.on("admin_subscribe", () => {
    const data = {};
    for (const [rid, room] of rooms.entries()) {
      data[rid] = {
        phase: room.phase,
        players: room.players,
        hands: room.hands,
        points: room.points,
        turnId: room.turnId
      };
    }
    socket.emit("admin_full_state", data);
  });

  socket.on("disconnect", () => {
    const rid = socket.data.roomId;
    if (!rid) return;

    const room = rooms.get(rid);
    if (!room) return;

    const nm = socket.data.name || socket.id.slice(0, 5);
    room.removePlayer(socket.id);
    logRoom(rid, `❌ ${nm} mất kết nối.`);
    emitRoom(rid);

    if (room.players.length === 0) {
      clearDeclareTimer(rid);
      rooms.delete(rid);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
