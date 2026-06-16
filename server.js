const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 'public' 폴더 안의 HTML 파일을 화면에 보여주도록 설정
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    if (!rooms[roomCode]) rooms[roomCode] = { players: {}, trades: [] };
    if (Object.keys(rooms[roomCode].players).length >= 10) {
      return socket.emit('errorMsg', '방이 가득 찼습니다! (최대 10명)');
    }
    rooms[roomCode].players[socket.id] = { name: playerName, id: socket.id };
    socket.join(roomCode);
    socket.emit('joinSuccess', { roomCode, playerName });
    io.to(roomCode).emit('updatePlayers', Object.values(rooms[roomCode].players));
  });

  socket.on('postTrade', ({ roomCode, cardCount }) => {
    const player = rooms[roomCode].players[socket.id];
    const tradeInfo = { tradeId: Math.random().toString(36).substr(2, 9), playerId: socket.id, playerName: player.name, cardCount };
    rooms[roomCode].trades.push(tradeInfo);
    io.to(roomCode).emit('updateTrades', rooms[roomCode].trades);
  });

  socket.on('acceptTrade', ({ roomCode, tradeId }) => {
    const tradeIndex = rooms[roomCode].trades.findIndex(t => t.tradeId === tradeId);
    if (tradeIndex !== -1) {
      const trade = rooms[roomCode].trades[tradeIndex];
      const acceptor = rooms[roomCode].players[socket.id];
      io.to(roomCode).emit('tradeCompleted', { msg: `🎉 ${trade.playerName} ↔ ${acceptor.name} (${trade.cardCount}장 교환 성사!)` });
      rooms[roomCode].trades.splice(tradeIndex, 1);
      io.to(roomCode).emit('updateTrades', rooms[roomCode].trades);
    }
  });

  socket.on('disconnect', () => {
    // 접속 종료 처리 (간단화)
  });
});

// Render 클라우드 환경을 위한 포트 자동 할당 (매우 중요)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`);
});