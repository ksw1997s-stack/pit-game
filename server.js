const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 🍎 카드 종류 (음식 이모티콘 10종)
const CARD_TYPES = ['🍎', '🍌', '🍇', '🍓', '🍕', '🍔', '🍟', '🍣', '🍩', '🍦'];

const rooms = {};

// 🃏 덱 생성 및 셔플 함수
function createAndShuffleDeck(playerCount) {
  let deck = [];
  // 참여 인원수만큼의 카드 종류만 사용 (각 종류당 9장씩)
  for (let i = 0; i < playerCount; i++) {
    for (let j = 0; j < 9; j++) {
      deck.push(CARD_TYPES[i]);
    }
  }
  
  // 피셔-예이츠 셔플 알고리즘 (오류 수정됨!)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]; // <--- deck[deck[i]] 로 되어있던 오타를 deck[i]로 수정했습니다.
  }
  
  return deck;
}

io.on('connection', (socket) => {
  // 1. 방 입장
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    if (!rooms[roomCode]) {
      // isStarted: 게임 시작 여부 플래그 추가
      rooms[roomCode] = { players: {}, trades: [], isStarted: false };
    }

    if (rooms[roomCode].isStarted) {
      return socket.emit('errorMsg', '이미 게임이 시작된 방입니다.');
    }

    const players = rooms[roomCode].players;
    if (Object.keys(players).length >= 10) {
      return socket.emit('errorMsg', '방이 가득 찼습니다! (최대 10명)');
    }

    players[socket.id] = { name: playerName, id: socket.id, cards: [] }; // cards 배열 추가
    socket.join(roomCode);
    socket.emit('joinSuccess', { roomCode, playerName });
    io.to(roomCode).emit('updatePlayers', Object.values(players));
  });

  // 🏁 2. 게임 시작 (방장이 버튼을 누른다고 가정)
  socket.on('startGame', (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;
    
    const playerIds = Object.keys(room.players);
    const playerCount = playerIds.length;

    if (playerCount < 2) {
      return socket.emit('errorMsg', '최소 2명이 필요합니다.');
    }

    room.isStarted = true;
    const deck = createAndShuffleDeck(playerCount);

    // 모든 플레이어에게 9장씩 카드 배분 및 전송
    playerIds.forEach((id, index) => {
      const playerCards = deck.slice(index * 9, (index + 1) * 9);
      room.players[id].cards = playerCards; // 서버에 저장
      io.to(id).emit('gameStarted', playerCards); // 해당 학생에게만 카드 전송
    });

    io.to(roomCode).emit('serverMsg', '🎮 게임이 시작되었습니다! 거래를 시작하세요!');
  });

  // 3. 교환 요청 올리기 (내 카드 중 무엇을 보낼지 선택)
  socket.on('postTrade', ({ roomCode, cardIndexes }) => {
    const room = rooms[roomCode];
    const player = room.players[socket.id];
    
    // 선택한 카드가 실제로 존재하는지 확인 (간단 예외처리)
    if (!cardIndexes || cardIndexes.length < 1 || cardIndexes.length > 4) return;
    
    // 교환 목록에 카드 인덱스 정보 저장 (비공개)
    const tradeInfo = {
      tradeId: Math.random().toString(36).substr(2, 9),
      playerId: socket.id,
      playerName: player.name,
      cardCount: cardIndexes.length,
      sendingCardIndexes: cardIndexes // 어떤 칸의 카드를 보낼지 저장
    };
    
    room.trades.push(tradeInfo);
    // 장터 업데이트 (보내는 카드가 무엇인지는 비밀)
    io.to(roomCode).emit('updateTrades', room.trades.map(t => ({ tradeId: t.tradeId, playerName: t.playerName, cardCount: t.cardCount, playerId: t.playerId })));
  });

  // 🤝 4. 교환 수락 (실제 카드 맞교환 발생)
  socket.on('acceptTrade', ({ roomCode, tradeId, myCardIndexes }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const tradeIndex = room.trades.findIndex(t => t.tradeId === tradeId);
    if (tradeIndex === -1) return;

    const trade = room.trades[tradeIndex]; // 요청자 정보
    const acceptorId = socket.id; // 수락자 ID
    const requesterId = trade.playerId; // 요청자 ID

    // 수락자가 보낸 카드 장수가 맞는지 확인
    if (myCardIndexes.length !== trade.cardCount) {
      return socket.emit('errorMsg', '교환 장수가 맞지 않습니다.');
    }

    const requester = room.players[requesterId];
    const acceptor = room.players[acceptorId];

    // --- 🃏 실제 카드 교환 로직 (서버 데이터 변경) ---
    // 1. 요청자가 보낼 카드 추출
    const cardsFromRequester = trade.sendingCardIndexes.map(idx => requester.cards[idx]);
    // 2. 수락자가 보낼 카드 추출
    const cardsFromAcceptor = myCardIndexes.map(idx => acceptor.cards[idx]);

    // 3. 요청자 카드 업데이트: 보낸 카드 제거하고 받은 카드 추가
    // 뒤에서부터 지워야 인덱스가 안 꼬임
    trade.sendingCardIndexes.sort((a,b)=>b-a).forEach(idx => requester.cards.splice(idx, 1));
    requester.cards.push(...cardsFromAcceptor);

    // 4. 수락자 카드 업데이트: 보낸 카드 제거하고 받은 카드 추가
    myCardIndexes.sort((a,b)=>b-a).forEach(idx => acceptor.cards.splice(idx, 1));
    acceptor.cards.push(...cardsFromRequester);

    // --- 📳 클라이언트 업데이트 ---
    // 각각의 새 카드 패 전송
    io.to(requesterId).emit('updateMyCards', requester.cards);
    io.to(acceptorId).emit('updateMyCards', acceptor.cards);

    // 전체 알림
    io.to(roomCode).emit('tradeCompleted', { msg: `🎉 ${trade.playerName} ↔ ${acceptor.name} (${trade.cardCount}장 교환 성사!)` });

    // 장터 목록 제거 및 업데이트
    room.trades.splice(tradeIndex, 1);
    io.to(roomCode).emit('updateTrades', room.trades.map(t => ({ tradeId: t.tradeId, playerName: t.playerName, cardCount: t.cardCount, playerId: t.playerId })));
  });

  socket.on('disconnect', () => { /* 종료 처리 생략 */ });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`서버 실행 중 (Port: ${PORT})`));