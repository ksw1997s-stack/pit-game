const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 'public' 폴더 안의 HTML 파일을 화면에 보여주도록 설정
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
  // 피셔-예이츠 셔플 알고리즘 (버그 수정 완료!)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]; 
  }
  return deck;
}

io.on('connection', (socket) => {
  // 1. 방 입장
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    if (!rooms[roomCode]) {
      rooms[roomCode] = { players: {}, trades: [], isStarted: false };
    }

    if (rooms[roomCode].isStarted) {
      return socket.emit('errorMsg', '이미 게임이 시작된 방입니다.');
    }

    const players = rooms[roomCode].players;
    if (Object.keys(players).length >= 10) {
      return socket.emit('errorMsg', '방이 가득 찼습니다! (최대 10명)');
    }

    players[socket.id] = { name: playerName, id: socket.id, cards: [] };
    socket.join(roomCode);
    socket.emit('joinSuccess', { roomCode, playerName });
    io.to(roomCode).emit('updatePlayers', Object.values(players));
  });

  // 🏁 2. 게임 시작
  socket.on('startGame', (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;
    
    const playerIds = Object.keys(room.players);
    const playerCount = playerIds.length;

    // 2명부터 시작 가능하도록 수정됨!
    if (playerCount < 2) {
      return socket.emit('errorMsg', '최소 2명이 필요합니다.');
    }

    room.isStarted = true;
    const deck = createAndShuffleDeck(playerCount);

    // 모든 플레이어에게 9장씩 카드 배분
    playerIds.forEach((id, index) => {
      const playerCards = deck.slice(index * 9, (index + 1) * 9);
      room.players[id].cards = playerCards; 
      io.to(id).emit('gameStarted', playerCards); 
    });

    io.to(roomCode).emit('serverMsg', '🎮 게임이 시작되었습니다! 거래를 시작하세요!');
  });

  // 3. 교환 요청 올리기
  socket.on('postTrade', ({ roomCode, cardIndexes }) => {
    const room = rooms[roomCode];
    const player = room.players[socket.id];
    
    if (!cardIndexes || cardIndexes.length < 1 || cardIndexes.length > 4) return;
    
    const tradeInfo = {
      tradeId: Math.random().toString(36).substr(2, 9),
      playerId: socket.id,
      playerName: player.name,
      cardCount: cardIndexes.length,
      sendingCardIndexes: cardIndexes 
    };
    
    room.trades.push(tradeInfo);
    io.to(roomCode).emit('updateTrades', room.trades.map(t => ({ tradeId: t.tradeId, playerName: t.playerName, cardCount: t.cardCount, playerId: t.playerId })));
  });

  // 🤝 4. 교환 수락 (실제 맞교환)
  socket.on('acceptTrade', ({ roomCode, tradeId, myCardIndexes }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const tradeIndex = room.trades.findIndex(t => t.tradeId === tradeId);
    if (tradeIndex === -1) return;

    const trade = room.trades[tradeIndex]; 
    const acceptorId = socket.id; 
    const requesterId = trade.playerId; 

    if (myCardIndexes.length !== trade.cardCount) {
      return socket.emit('errorMsg', '교환 장수가 맞지 않습니다.');
    }

    const requester = room.players[requesterId];
    const acceptor = room.players[acceptorId];

    const cardsFromRequester = trade.sendingCardIndexes.map(idx => requester.cards[idx]);
    const cards