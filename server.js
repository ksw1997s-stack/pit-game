const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const CARD_TYPES = ['🍎', '🍌', '🍇', '🍓', '🍕', '🍔', '🍟', '🍣', '🍩', '🍦'];
const rooms = {};

function createAndShuffleDeck(playerCount) {
  let deck = [];
  for (let i = 0; i < playerCount; i++) {
    for (let j = 0; j < 9; j++) {
      deck.push(CARD_TYPES[i]);
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    if (!rooms[roomCode]) rooms[roomCode] = { players: {}, trades: [], isStarted: false };
    if (rooms[roomCode].isStarted) return socket.emit('errorMsg', '이미 게임이 시작된 방입니다.');
    
    rooms[roomCode].players[socket.id] = { name: playerName, id: socket.id, cards: [] };
    socket.join(roomCode);
    socket.emit('joinSuccess', { roomCode, playerName });
    io.to(roomCode).emit('updatePlayers', Object.values(rooms[roomCode].players));
  });

  socket.on('startGame', (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;
    const playerIds = Object.keys(room.players);
    if (playerIds.length < 2) return socket.emit('errorMsg', '최소 2명이 필요합니다.');

    room.isStarted = true;
    const deck = createAndShuffleDeck(playerIds.length);
    playerIds.forEach((id, index) => {
      const playerCards = deck.slice(index * 9, (index + 1) * 9);
      room.players[id].cards = playerCards;
      io.to(id).emit('gameStarted', playerCards);
    });
    io.to(roomCode).emit('serverMsg', '🎮 게임이 시작되었습니다!');
  });

  socket.on('postTrade', ({ roomCode, cardIndexes }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const tradeInfo = {
      tradeId: Math.random().toString(36).substr(2, 9),
      playerId: socket.id,
      playerName: room.players[socket.id].name,
      cardCount: cardIndexes.length,
      sendingCardIndexes: cardIndexes
    };
    room.trades.push(tradeInfo);
    io.to(roomCode).emit('updateTrades', room.trades.map(t => ({ tradeId: t.tradeId, playerName: t.playerName, cardCount: t.cardCount, playerId: t.playerId })));
  });

  socket.on('acceptTrade', ({ roomCode, tradeId, myCardIndexes }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const tradeIndex = room.trades.findIndex(t => t.tradeId === tradeId);
    if (tradeIndex === -1) return;

    const trade = room.trades[tradeIndex];
    const requester = room.players[trade.playerId];
    const acceptor = room.players[socket.id];

    if (myCardIndexes.length !== trade.cardCount) return socket.emit('errorMsg', '교환 장수가 맞지 않습니다.');

    const cardsFromRequester = trade.sendingCardIndexes.map(idx => requester.cards[idx]);
    const cardsFromAcceptor = myCardIndexes.map(idx => acceptor.cards[idx]);

    trade.sendingCardIndexes.sort((a,b)=>b-a).forEach(idx => requester.cards.splice(idx, 1));
    requester.cards.push(...cardsFromAcceptor);
    myCardIndexes.sort((a,b)=>b-a).forEach(idx => acceptor.cards.splice(idx, 1));
    acceptor.cards.push(...cardsFromRequester);

    io.to(trade.playerId).emit('updateMyCards', requester.cards);
    io.to(socket.id).emit('updateMyCards', acceptor.cards);
    
    room.trades.splice(tradeIndex, 1);
    io.to(roomCode).emit('updateTrades', room.trades.map(t => ({ tradeId: t.tradeId, playerName: t.playerName, cardCount: t.cardCount, playerId: t.playerId })));
  });

  socket.on('declareVictory', (roomCode) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players[socket.id];
    const isAllSame = player.cards.length === 9 && player.cards.every(c => c === player.cards[0]);
    if (isAllSame) {
      room.isStarted = false;
      io.to(roomCode).emit('gameOver', { winnerName: player.name, winningCard: player.cards[0] });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`서버 실행 중!`));