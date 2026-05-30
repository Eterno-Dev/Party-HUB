import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '../contexts/GameContext';
import { subscribeToRoom, changeGame, voteForGame, toggleVoting, leaveRoom } from '../lib/roomService';

const GAMES = [
  { id: 'chameleon', title: 'El Camaleón', icon: '🦎', color: 'var(--color-accent-red)', minPlayers: 3 },
  { id: 'bomb', title: 'La Bomba', icon: '💣', color: 'var(--color-accent-yellow)', minPlayers: 2 },
  { id: 'never', title: 'Yo Nunca', icon: '🍻', color: 'var(--color-secondary)', minPlayers: 2 },
  { id: 'wolf', title: 'El Lobo', icon: '🐺', color: '#4B0082', minPlayers: 4 }
];

export default function Lobby() {
  const navigate = useNavigate();
  const { roomPin, setRoomPin, player, roomData, setRoomData } = useGame();
  
  const [chargingGame, setChargingGame] = useState(null);

  const handleLeaveRoom = async () => {
    if (roomPin && player) {
      await leaveRoom(roomPin, player.id);
    }
    setRoomPin(null);
    setRoomData(null);
    navigate('/');
  };

  // 1. Suscripción a Firebase
  useEffect(() => {
    if (!roomPin || !player) {
      navigate('/');
      return;
    }

    const unsubscribe = subscribeToRoom(roomPin, (data) => {
      if (data.status === 'deleted') {
        setRoomPin(null);
        setRoomData(null);
        navigate('/');
        return;
      }
      setRoomData(data);
      if (data.status !== 'lobby') {
        navigate(`/${data.status}`);
      }
    });

    return () => unsubscribe();
  }, [roomPin, player, navigate, setRoomData]);

  // Asegurarnos de que no rompe si no hay datos
  const isHost = roomData?.players?.find(p => p.id === player?.id)?.isHost || false;

  // 2. Cálculo de Mayoría
  useEffect(() => {
    if (!roomData) return;

    if (!roomData.votingActive) {
      if (chargingGame) setChargingGame(null);
      return;
    }

    const totalPlayers = roomData.players.length;
    const votesNeeded = Math.floor(totalPlayers / 2) + 1;

    const voteCounts = {};
    Object.values(roomData.votes || {}).forEach(gameId => {
      voteCounts[gameId] = (voteCounts[gameId] || 0) + 1;
    });

    let majorityGame = null;
    for (const [gameId, count] of Object.entries(voteCounts)) {
      if (count >= votesNeeded) {
        majorityGame = gameId;
        break;
      }
    }

    if (majorityGame !== chargingGame) {
      setChargingGame(majorityGame);
    }
  }, [roomData?.votes, roomData?.votingActive, roomData?.players?.length, chargingGame]);

  // 3. Temporizador independiente
  useEffect(() => {
    if (!chargingGame) return;
    
    const timer = setTimeout(() => {
      if (isHost) {
        changeGame(roomPin, chargingGame);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [chargingGame, isHost, roomPin]);

  // EARLY RETURN SEGURO DESPUÉS DE LOS HOOKS
  if (!roomData) return <div className="app-container" style={{justifyContent: 'center', alignItems: 'center'}}><h2>Cargando sala...</h2></div>;

  const handleVote = (gameId) => {
    if (!roomData.votingActive) return;
    const gameInfo = GAMES.find(g => g.id === gameId);
    if (gameInfo && roomData.players.length < gameInfo.minPlayers) return; // Proteccion extra
    voteForGame(roomPin, player.id, gameId);
  };

  const handleToggleVoting = () => {
    toggleVoting(roomPin, !roomData.votingActive);
  };

  const votes = roomData.votes || {};
  const votesByGame = {};
  GAMES.forEach(g => votesByGame[g.id] = []);
  
  Object.entries(votes).forEach(([playerId, gameId]) => {
    const voter = roomData.players.find(p => p.id === playerId);
    if (voter && votesByGame[gameId]) {
      votesByGame[gameId].push(voter);
    }
  });

  return (
    <div className="app-container" style={{ padding: '12px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', flex: 1 }}>
          {roomData.players.map(p => (
            <div key={p.id} style={{ 
              background: 'var(--color-surface)', padding: '4px 12px', borderRadius: '100px', 
              fontSize: '0.85rem', fontWeight: 800, boxShadow: 'var(--shadow-sm)',
              border: p.id === player.id ? '2px solid var(--color-primary)' : 'none', whiteSpace: 'nowrap'
            }}>
              {p.isHost && '👑 '} {p.name}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ background: 'var(--color-primary)', color: 'white', padding: '4px 12px', borderRadius: '8px', fontWeight: 900 }}>
            PIN: {roomPin}
          </div>
          <button 
            onClick={handleLeaveRoom}
            style={{ background: 'var(--color-accent-red)', color: 'white', padding: '4px 12px', borderRadius: '8px', fontWeight: 900, border: 'none', cursor: 'pointer' }}
          >
            SALIR
          </button>
        </div>
      </header>

      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ color: 'var(--color-text)', fontSize: '1.5rem' }}>
          {roomData.votingActive ? '¡Vota tu favorito!' : 'Esperando a los jugadores...'}
        </h2>
        <p style={{ color: '#666', fontWeight: 600, marginTop: '8px' }}>
          {roomData.votingActive ? 'Cuando un juego tenga mayoría, comenzará en 3 segundos.' : 'El Host debe activar la votación cuando estéis listos.'}
        </p>
        
        {isHost && (
          <button 
            className={`btn-party ${roomData.votingActive ? 'btn-red' : 'btn-blue'}`}
            onClick={handleToggleVoting}
            style={{ marginTop: '16px' }}
          >
            {roomData.votingActive ? 'Detener Votación' : '¡Comenzar Votación!'}
          </button>
        )}
      </div>
      
      <div style={{ 
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', 
        gap: '16px', flex: 1, position: 'relative',
        opacity: roomData.votingActive ? 1 : 0.5,
        pointerEvents: roomData.votingActive ? 'auto' : 'none',
        transition: 'opacity 0.3s'
      }}>
        {[...GAMES].sort((a, b) => {
          const aEnough = roomData.players.length >= a.minPlayers;
          const bEnough = roomData.players.length >= b.minPlayers;
          if (aEnough && !bEnough) return -1;
          if (!aEnough && bEnough) return 1;
          return 0;
        }).map(game => {
          const gameVotes = votesByGame[game.id];
          const hasVotedThis = votes[player.id] === game.id;
          const isCharging = chargingGame === game.id;
          const hasEnoughPlayers = roomData.players.length >= game.minPlayers;
          
          return (
            <motion.div 
              key={game.id}
              whileHover={{ scale: roomData.votingActive && hasEnoughPlayers ? 1.02 : 1 }}
              whileTap={{ scale: roomData.votingActive && hasEnoughPlayers ? 0.95 : 1 }}
              onClick={() => hasEnoughPlayers ? handleVote(game.id) : null}
              style={{
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                cursor: roomData.votingActive && hasEnoughPlayers ? 'pointer' : 'not-allowed',
                boxShadow: hasVotedThis ? `0 0 0 4px ${game.color}` : 'var(--shadow-sm)',
                position: 'relative',
                border: `2px solid ${hasVotedThis ? game.color : 'transparent'}`,
                overflow: 'hidden',
                filter: hasEnoughPlayers ? 'none' : 'grayscale(100%) opacity(0.6)'
              }}
            >
              {isCharging && (
                <div 
                  className="charge-circle" 
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                    background: `${game.color}33`, zIndex: 0
                  }}
                />
              )}

              <div style={{ zIndex: 1, fontSize: '3rem', background: `${game.color}22`, width: '70px', height: '70px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {game.icon}
              </div>
              <h3 style={{ zIndex: 1, fontSize: '1rem', textAlign: 'center', color: hasEnoughPlayers ? game.color : '#888' }}>{game.title}</h3>
              
              {!hasEnoughPlayers && (
                <div style={{ zIndex: 1, fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--color-accent-red)', textAlign: 'center', background: 'rgba(255,0,0,0.1)', padding: '2px 8px', borderRadius: '12px' }}>
                  Faltan {game.minPlayers - roomData.players.length} {game.minPlayers - roomData.players.length === 1 ? 'jugador' : 'jugadores'}
                </div>
              )}

              <div style={{ zIndex: 1, display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center', minHeight: '24px' }}>
                <AnimatePresence>
                  {gameVotes.map(voter => (
                    <motion.div
                      key={voter.id}
                      initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
                      style={{ background: game.color, color: 'white', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '100px', fontWeight: 'bold' }}
                    >
                      {voter.name}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              
              {isCharging && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ position: 'absolute', bottom: '4px', fontSize: '0.7rem', fontWeight: 'bold', color: game.color, zIndex: 1 }}>
                  ¡Empezando...!
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>
      
      <style>{`
        @keyframes fillUp {
          0% { transform: translateY(100%); }
          100% { transform: translateY(0%); }
        }
        .charge-circle {
          animation: fillUp 3s linear forwards;
        }
      `}</style>
    </div>
  );
}
