import { db } from './firebase';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, arrayUnion, onSnapshot } from 'firebase/firestore';

// Generar un PIN aleatorio de 4 dígitos
const generatePin = () => Math.floor(1000 + Math.random() * 9000).toString();

// Crear una nueva sala
export const createRoom = async (user) => {
  const pin = generatePin();
  const roomRef = doc(db, 'rooms', pin);
  
  const roomData = {
    pin,
    status: 'lobby', // lobby, chameleon, bomb, never_have_i_ever
    currentGame: null,
    players: [{
      id: user.id,
      name: user.name,
      isHost: true,
      score: 0,
      stats: {}
    }],
    votes: {},
    votingActive: false, // Control de votación
    createdAt: new Date().toISOString()
  };

  await setDoc(roomRef, roomData);
  return { pin };
};

// Unirse a una sala existente
export const joinRoom = async (pin, user) => {
  const roomRef = doc(db, 'rooms', pin);
  const roomSnap = await getDoc(roomRef);

  if (!roomSnap.exists()) {
    throw new Error('La sala no existe');
  }

  // Verificar si ya está en la sala
  const currentPlayers = roomSnap.data().players || [];
  if (currentPlayers.find(p => p.id === user.id)) {
    return { pin }; // Ya estaba dentro, simplemente entra
  }

  const newPlayer = {
    id: user.id,
    name: user.name,
    isHost: false,
    score: 0,
    stats: {}
  };

  await updateDoc(roomRef, {
    players: arrayUnion(newPlayer)
  });

  return { pin };
};

// Escuchar cambios en la sala en tiempo real
export const subscribeToRoom = (pin, callback) => {
  const roomRef = doc(db, 'rooms', pin);
  return onSnapshot(roomRef, (doc) => {
    if (doc.exists()) {
      callback(doc.data());
    } else {
      callback({ status: 'deleted' });
    }
  });
};

// Abandonar sala
export const leaveRoom = async (pin, playerId) => {
  const roomRef = doc(db, 'rooms', pin);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) return;
  
  const data = roomSnap.data();
  const isHost = data.players.find(p => p.id === playerId)?.isHost;
  
  if (isHost) {
    await deleteDoc(roomRef);
  } else {
    const newPlayers = data.players.filter(p => p.id !== playerId);
    await updateDoc(roomRef, { players: newPlayers });
  }
};

// Cambiar el juego activo (solo Host)
export const changeGame = async (pin, gameId) => {
  const roomRef = doc(db, 'rooms', pin);
  await updateDoc(roomRef, {
    status: gameId,
    currentGame: gameId,
    votingActive: false,
    votes: {}, // Reseteamos votos al empezar
    bombState: { 
      status: 'waiting', 
      lives: {}, 
      currentPlayerId: null, 
      currentTopic: null,
      hasStarted: false,
      deathOrder: [],
      config: { maxLives: 3, minTime: 4, maxTime: 15 }
    },
    chameleonState: {
      status: 'waiting',
      category: null,
      secretWord: null,
      chameleonIds: [],
      votes: {},
      readyPlayers: [],
      speakingOrder: [],
      currentSpeakerIndex: 0,
      hasStarted: false,
      config: { impostorsCount: 1, hasClue: true, roundsCount: 1 }
    },
    neverState: {
      status: 'waiting',
      hasStarted: false,
      config: { totalQuestions: 10 },
      currentQuestionIndex: 0,
      questionsList: [],
      roundAnswers: {},
      scores: {}
    },
    wolfState: {
      status: 'waiting',
      hasStarted: false,
      config: { 
        wolvesCount: 1,
        hasWitch: true,
        hasCupid: false,
        hasHunter: false,
        hasSeer: true,
        hasLittleGirl: false
      },
      roles: {}, 
      readyPlayers: [],
      alivePlayers: [], 
      lovers: [], 
      witchPotions: { heal: true, kill: true },
      nightVictim: null, 
      hunterTarget: null, 
      votes: {}, 
      history: [] 
    }
  });
};

// Activar/Desactivar votación (solo Host)
export const toggleVoting = async (pin, isActive) => {
  const roomRef = doc(db, 'rooms', pin);
  await updateDoc(roomRef, {
    votingActive: isActive,
    votes: {} // Resetear votos al cambiar estado
  });
};

// Votar por un juego (Cualquier jugador)
export const voteForGame = async (pin, playerId, gameId) => {
  const roomRef = doc(db, 'rooms', pin);
  await updateDoc(roomRef, {
    [`votes.${playerId}`]: gameId
  });
};
