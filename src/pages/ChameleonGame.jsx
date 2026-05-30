import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '../contexts/GameContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { subscribeToRoom } from '../lib/roomService';
import CHAMELEON_TOPICS from '../lib/chameleonTopics.json';

export default function ChameleonGame() {
  const navigate = useNavigate();
  const { roomPin, player, roomData, setRoomData } = useGame();
  const [debugError, setDebugError] = useState('');

  // Sincronización en tiempo real con Firebase
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
      if (data.status !== 'chameleon') {
        navigate(data.status === 'lobby' ? '/lobby' : `/${data.status}`);
      }
    });

    return () => unsubscribe();
  }, [roomPin, player, navigate, setRoomData]);

  if (!roomData || roomData.status !== 'chameleon') return null;

  const gameState = roomData.chameleonState || { 
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
  };

  const config = gameState.config || { impostorsCount: 1, hasClue: true, roundsCount: 1 };

  const updateChameleonState = async (updates) => {
    try {
      const flatUpdates = {};
      Object.keys(updates).forEach(key => {
        flatUpdates[`chameleonState.${key}`] = updates[key];
      });
      await updateDoc(doc(db, 'rooms', roomPin), flatUpdates);
    } catch (e) {
      setDebugError("Error Firebase: " + e.message);
    }
  };

  const handleConfigChange = async (field, value) => {
    let val = field === 'hasClue' ? value : parseInt(value);
    if (field !== 'hasClue' && isNaN(val)) return;
    
    // Validaciones
    if (field === 'impostorsCount' && (val < 1 || val >= roomData.players.length)) return;
    if (field === 'roundsCount' && (val < 1 || val > 5)) return;

    await updateChameleonState({ config: { ...config, [field]: val } });
  };

  // --- LÓGICA DEL HOST ---
  const startRoundAsHost = async () => {
    try {
      const categories = Object.keys(CHAMELEON_TOPICS);
      const randomCategory = categories[Math.floor(Math.random() * categories.length)];
      const words = CHAMELEON_TOPICS[randomCategory];
      const randomWordObj = words[Math.floor(Math.random() * words.length)];
      
      // Seleccionar impostores únicos
      let availablePlayers = [...roomData.players];
      let chosenImpostors = [];
      for (let i = 0; i < config.impostorsCount; i++) {
        if (availablePlayers.length === 0) break;
        const idx = Math.floor(Math.random() * availablePlayers.length);
        chosenImpostors.push(availablePlayers[idx].id);
        availablePlayers.splice(idx, 1);
      }

      await updateChameleonState({
        status: 'reading_roles',
        category: randomCategory,
        secretWord: randomWordObj, // Objeto { palabra, pista }
        chameleonIds: chosenImpostors,
        votes: {},
        readyPlayers: [],
        speakingOrder: [],
        currentSpeakerIndex: 0,
        hasStarted: true
      });
    } catch (e) {
      setDebugError("Error al iniciar: " + e.message);
    }
  };

  const checkEveryoneReady = async (newReadyPlayers) => {
    if (newReadyPlayers.length >= roomData.players.length) {
      // Todos listos, generar orden aleatorio
      let order = [...roomData.players].map(p => p.id);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }

      await updateChameleonState({
        status: 'speaking',
        speakingOrder: order,
        currentSpeakerIndex: 0
      });
    }
  };

  const setPlayerReady = async () => {
    if (gameState.readyPlayers.includes(player.id)) return;
    const newReadyPlayers = [...gameState.readyPlayers, player.id];
    await updateChameleonState({ readyPlayers: newReadyPlayers });
    
    // El host o el último jugador en pulsar comprueba si todos están listos
    if (newReadyPlayers.length >= roomData.players.length) {
      checkEveryoneReady(newReadyPlayers);
    }
  };

  const nextTurn = async () => {
    const totalTurns = gameState.speakingOrder.length * config.roundsCount;
    const nextIndex = gameState.currentSpeakerIndex + 1;
    
    if (nextIndex >= totalTurns) {
      await updateChameleonState({ status: 'voting' });
    } else {
      await updateChameleonState({ currentSpeakerIndex: nextIndex });
    }
  };

  const revealResults = async () => {
    await updateChameleonState({ status: 'reveal' });
  };

  const returnToLobby = async () => {
    const isHost = roomData.players.find(p => p.id === player.id)?.isHost;
    if (isHost) {
      await updateDoc(doc(db, 'rooms', roomPin), { status: 'lobby', chameleonState: null });
    }
  };

  // --- LÓGICA DE JUGADOR ---
  const handleVote = async (targetId) => {
    if (gameState.status !== 'voting') return;
    const currentVotes = gameState.votes || {};
    await updateChameleonState({
      votes: { ...currentVotes, [player.id]: targetId }
    });
  };

  // Variables UI
  const isHost = roomData.players.find(p => p.id === player.id)?.isHost || false;
  const isChameleon = gameState.chameleonIds.includes(player.id);
  const myVote = (gameState.votes || {})[player.id];
  const amIReady = gameState.readyPlayers.includes(player.id);

  // Turnos
  const currentSpeakerId = gameState.speakingOrder[gameState.currentSpeakerIndex % gameState.speakingOrder.length];
  const currentSpeaker = roomData.players.find(p => p.id === currentSpeakerId);
  const isMyTurn = currentSpeakerId === player.id;
  const currentRound = Math.floor(gameState.currentSpeakerIndex / gameState.speakingOrder.length) + 1;

  // Calcular resultados
  let maxVotes = 0;
  let mostVotedPlayers = [];
  if (gameState.status === 'reveal') {
    const voteCounts = {};
    Object.values(gameState.votes || {}).forEach(v => {
      voteCounts[v] = (voteCounts[v] || 0) + 1;
    });

    Object.entries(voteCounts).forEach(([pid, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        mostVotedPlayers = [pid];
      } else if (count === maxVotes) {
        mostVotedPlayers.push(pid);
      }
    });
  }

  const caughtChameleons = gameState.chameleonIds.filter(id => mostVotedPlayers.includes(id));
  const escapedChameleons = gameState.chameleonIds.filter(id => !mostVotedPlayers.includes(id));

  return (
    <div className="app-container" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
      
      {debugError && (
        <div style={{ background: 'var(--color-accent-red)', color: 'white', padding: '16px', borderRadius: '12px', marginBottom: '16px', fontWeight: 'bold' }}>
          ATENCIÓN ERROR: {debugError}
        </div>
      )}

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ color: 'var(--color-primary)' }}>🦎 El Camaleón</h2>
      </header>

      {/* PANTALLA: ESPERANDO */}
      {gameState.status === 'waiting' && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: '5rem', marginBottom: '20px' }}>🦎</div>
          <h3 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>Atrapa al Camaleón</h3>
          <p style={{ color: '#666', marginBottom: '24px' }}>
            A todos se os dará una palabra secreta, excepto al Camaleón. 
            Decid palabras relacionadas por turnos para demostrar que sabéis la palabra.
          </p>
          
          {isHost ? (
            <button className="btn-party btn-blue" onClick={startRoundAsHost} style={{ fontSize: '1.5rem', padding: '20px' }}>
              ¡Repartir Roles!
            </button>
          ) : (
            <div style={{ background: 'var(--color-bg)', padding: '20px', borderRadius: '12px' }}>
              <p style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>Esperando a que el anfitrión comience...</p>
            </div>
          )}

          {/* Configuración de sala (Solo Host) */}
          {isHost && !gameState.hasStarted && (
            <div style={{ marginTop: '32px', textAlign: 'left', background: 'var(--color-surface)', padding: '16px', borderRadius: '12px', boxShadow: 'var(--shadow-sm)' }}>
              <h4 style={{ marginBottom: '16px', color: 'var(--color-primary)' }}>⚙️ Configuración de la Partida</h4>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontWeight: 'bold' }}>Nº de Impostores:</span>
                <input 
                  type="number" min="1" max={Math.max(1, roomData.players.length - 1)} value={config.impostorsCount}
                  onChange={(e) => handleConfigChange('impostorsCount', e.target.value)}
                  style={{ width: '60px', padding: '4px 8px', borderRadius: '8px', border: '1px solid #ccc', textAlign: 'center' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontWeight: 'bold' }}>Vueltas de palabras:</span>
                <input 
                  type="number" min="1" max="5" value={config.roundsCount}
                  onChange={(e) => handleConfigChange('roundsCount', e.target.value)}
                  style={{ width: '60px', padding: '4px 8px', borderRadius: '8px', border: '1px solid #ccc', textAlign: 'center' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold' }}>¿Pistas para impostores?:</span>
                <input 
                  type="checkbox" checked={config.hasClue}
                  onChange={(e) => handleConfigChange('hasClue', e.target.checked)}
                  style={{ transform: 'scale(1.5)' }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* PANTALLA: LEYENDO ROLES */}
      {gameState.status === 'reading_roles' && (
        <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginBottom: '8px', color: '#666' }}>CATEGORÍA:</h3>
          <h1 style={{ color: 'var(--color-primary)', fontSize: '2.5rem', marginBottom: '32px' }}>{gameState.category}</h1>

          <AnimatePresence>
            <motion.div 
              initial={{ scale: 0 }} animate={{ scale: 1 }}
              style={{ 
                background: isChameleon ? 'var(--color-accent-red)' : 'var(--color-accent-green)', 
                padding: '40px 20px', 
                borderRadius: '24px', 
                color: 'white',
                boxShadow: 'var(--shadow-md)'
              }}
            >
              <div style={{ fontSize: '4rem', marginBottom: '16px' }}>{isChameleon ? '🦎' : '🤫'}</div>
              <p style={{ fontSize: '1.2rem', marginBottom: '8px', fontWeight: 'bold' }}>
                {isChameleon ? 'TÚ ERES EL CAMALEÓN' : 'LA PALABRA SECRETA ES:'}
              </p>
              <h2 style={{ fontSize: '2.5rem', margin: '0', marginBottom: '16px' }}>
                {isChameleon ? '¡Finge que lo sabes!' : gameState.secretWord?.palabra}
              </h2>
              
              {isChameleon && config.hasClue && gameState.secretWord?.pista && (
                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
                  <p style={{ fontSize: '0.9rem', margin: 0 }}><strong>Pista:</strong> {gameState.secretWord.pista}</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div style={{ flex: 1 }}></div>

          <div style={{ background: 'var(--color-surface)', padding: '16px', borderRadius: '12px', marginBottom: '24px' }}>
            <p style={{ margin: 0, fontWeight: 'bold' }}>
              Jugadores listos: {gameState.readyPlayers.length} / {roomData.players.length}
            </p>
          </div>

          <button 
            className="btn-party btn-blue" 
            onClick={setPlayerReady} 
            disabled={amIReady}
            style={{ 
              padding: '20px', 
              fontSize: '1.5rem',
              opacity: amIReady ? 0.5 : 1,
              cursor: amIReady ? 'not-allowed' : 'pointer'
            }}
          >
            {amIReady ? 'Esperando al resto...' : '¡Listo!'}
          </button>
        </div>
      )}

      {/* PANTALLA: HABLANDO (TURNOS) */}
      {gameState.status === 'speaking' && (
        <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ background: 'var(--color-bg)', padding: '12px', borderRadius: '100px', alignSelf: 'center', marginBottom: '24px', fontWeight: 'bold' }}>
            Ronda {currentRound} de {config.roundsCount}
          </div>

          <h3 style={{ color: '#666', marginBottom: '16px' }}>Es el turno de:</h3>
          
          <motion.div 
            key={currentSpeakerId}
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            style={{ 
              background: isMyTurn ? 'var(--color-primary)' : 'var(--color-surface)', 
              color: isMyTurn ? 'white' : 'var(--color-text)',
              padding: '40px 20px', 
              borderRadius: '24px', 
              boxShadow: 'var(--shadow-md)',
              marginBottom: '32px'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>{isMyTurn ? '🗣️' : '👂'}</div>
            <h1 style={{ fontSize: '2.5rem', margin: 0 }}>
              {isMyTurn ? '¡TÚ!' : currentSpeaker?.name}
            </h1>
            <p style={{ marginTop: '16px', fontSize: '1.2rem', opacity: 0.9 }}>
              {isMyTurn ? 'Di tu palabra en voz alta.' : 'Escuchando con atención...'}
            </p>
          </motion.div>

          <div style={{ flex: 1 }}></div>

          {(isMyTurn || isHost) && (
            <button 
              className="btn-party btn-blue" 
              onClick={nextTurn} 
              style={{ padding: '20px', fontSize: '1.2rem' }}
            >
              {isMyTurn ? 'Terminar mi turno' : 'Forzar Siguiente Turno (Host)'}
            </button>
          )}
        </div>
      )}

      {/* PANTALLA: VOTANDO */}
      {gameState.status === 'voting' && (
        <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ marginBottom: '16px', color: 'var(--color-primary)' }}>¿Quién es el Camaleón?</h2>
          <p style={{ color: '#666', marginBottom: '24px' }}>Vota por la persona que creas que estaba fingiendo.</p>

          <div style={{ display: 'grid', gap: '12px' }}>
            {/* Ahora NO filtramos a uno mismo. Puedes votarte a ti mismo. */}
            {roomData.players.map(p => {
              const isSelected = myVote === p.id;
              return (
                <button 
                  key={p.id}
                  onClick={() => handleVote(p.id)}
                  style={{
                    background: isSelected ? 'var(--color-primary)' : 'var(--color-surface)',
                    color: isSelected ? 'white' : 'var(--color-text)',
                    padding: '16px',
                    borderRadius: '12px',
                    border: `2px solid ${isSelected ? 'var(--color-primary)' : 'transparent'}`,
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    boxShadow: 'var(--shadow-sm)',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {p.name} {p.id === player.id ? '(Tú)' : ''}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: '24px', background: 'var(--color-bg)', padding: '12px', borderRadius: '8px' }}>
            Votos emitidos: {Object.keys(gameState.votes || {}).length} / {roomData.players.length}
          </div>

          <div style={{ flex: 1 }}></div>

          {isHost && (
            <button className="btn-party btn-blue" onClick={revealResults} style={{ marginTop: '24px', padding: '20px', fontSize: '1.2rem' }}>
              Revelar Resultados
            </button>
          )}
        </div>
      )}

      {/* PANTALLA: RESULTADOS */}
      {gameState.status === 'reveal' && (
        <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            <h3 style={{ color: '#666', marginBottom: '8px' }}>LOS CAMALEONES ERAN:</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px', marginBottom: '16px' }}>
              {gameState.chameleonIds.map(id => {
                const p = roomData.players.find(pl => pl.id === id);
                return <span key={id} style={{ background: 'var(--color-accent-red)', color: 'white', padding: '8px 16px', borderRadius: '100px', fontWeight: 'bold', fontSize: '1.5rem' }}>{p?.name}</span>;
              })}
            </div>
            
            <p style={{ fontSize: '1.2rem', color: '#666', marginBottom: '32px' }}>
              La palabra secreta era: <strong>{gameState.secretWord?.palabra}</strong>
            </p>

            <div style={{ background: escapedChameleons.length > 0 ? 'var(--color-accent-red)' : 'var(--color-accent-green)', color: 'white', padding: '24px', borderRadius: '16px', marginBottom: '32px' }}>
              <div style={{ fontSize: '4rem', marginBottom: '16px' }}>{escapedChameleons.length > 0 ? '🦎💨' : '🎯'}</div>
              <h2 style={{ margin: 0 }}>
                {escapedChameleons.length > 0 ? `¡ESCAPARON ${escapedChameleons.length} CAMALEONES!` : '¡CAZASTEIS A TODOS!'}
              </h2>
            </div>
            
            <div style={{ background: 'var(--color-surface)', padding: '16px', borderRadius: '12px', textAlign: 'left' }}>
              <h4 style={{ marginBottom: '12px', color: 'var(--color-primary)' }}>Votaciones:</h4>
              {roomData.players.map(p => {
                const votesReceived = Object.values(gameState.votes || {}).filter(v => v === p.id).length;
                if (votesReceived === 0) return null;
                const wasImpostor = gameState.chameleonIds.includes(p.id);
                return (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                    <strong>{p.name} {wasImpostor ? '🦎' : ''}</strong>
                    <span>{votesReceived} votos</span>
                  </div>
                );
              })}
            </div>
          </motion.div>

          <div style={{ flex: 1 }}></div>

          {isHost && (
            <button className="btn-party btn-blue" onClick={returnToLobby} style={{ marginTop: '32px', padding: '20px', fontSize: '1.2rem' }}>
              Volver al Lobby
            </button>
          )}
        </div>
      )}
    </div>
  );
}
