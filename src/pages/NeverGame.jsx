import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '../contexts/GameContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { subscribeToRoom } from '../lib/roomService';
import NEVER_QUESTIONS from '../lib/neverQuestions.json';

export default function NeverGame() {
  const navigate = useNavigate();
  const { roomPin, player, roomData, setRoomData } = useGame();
  const [debugError, setDebugError] = useState('');
  const [localCountdown, setLocalCountdown] = useState(3);

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
      if (data.status !== 'never') {
        navigate(data.status === 'lobby' ? '/lobby' : `/${data.status}`);
      }
    });

    return () => unsubscribe();
  }, [roomPin, player, navigate, setRoomData]);

  const gameState = roomData?.neverState || { 
    status: 'waiting', 
    hasStarted: false,
    config: { totalQuestions: 10 },
    currentQuestionIndex: 0,
    nextQuestionIndex: 0,
    questionsList: [],
    roundAnswers: {},
    scores: {}
  };

  const isHost = roomData?.players?.find(p => p.id === player?.id)?.isHost || false;

  // Temporizador de cuenta atrás
  useEffect(() => {
    if (gameState.status === 'countdown') {
      setLocalCountdown(3);
      
      const timer = setInterval(() => {
        setLocalCountdown(c => c > 0 ? c - 1 : 0);
      }, 1000);

      let timeout;
      if (isHost) {
        timeout = setTimeout(() => {
          updateNeverState({
            status: 'playing',
            currentQuestionIndex: gameState.nextQuestionIndex
          });
        }, 3000);
      }

      return () => {
        clearInterval(timer);
        if (timeout) clearTimeout(timeout);
      };
    }
  }, [gameState.status, isHost, roomPin, gameState.nextQuestionIndex]);

  if (!roomData || roomData.status !== 'never') return null;

  const config = gameState.config || { totalQuestions: 10 };

  const updateNeverState = async (updates) => {
    try {
      const flatUpdates = {};
      Object.keys(updates).forEach(key => {
        flatUpdates[`neverState.${key}`] = updates[key];
      });
      await updateDoc(doc(db, 'rooms', roomPin), flatUpdates);
    } catch (e) {
      setDebugError("Error Firebase: " + e.message);
    }
  };

  const handleConfigChange = async (field, value) => {
    let val = parseInt(value);
    if (isNaN(val) || val < 1 || val > 50) return;
    await updateNeverState({ config: { ...config, [field]: val } });
  };

  // --- LÓGICA DEL HOST ---
  const startGameAsHost = async () => {
    try {
      // Seleccionar preguntas aleatorias
      let availableQuestions = [...NEVER_QUESTIONS];
      let chosenQuestions = [];
      const total = Math.min(config.totalQuestions, availableQuestions.length);
      
      for (let i = 0; i < total; i++) {
        const idx = Math.floor(Math.random() * availableQuestions.length);
        chosenQuestions.push(availableQuestions[idx]);
        availableQuestions.splice(idx, 1);
      }

      // Inicializar scores a 0
      const initialScores = {};
      roomData.players.forEach(p => initialScores[p.id] = 0);

      await updateNeverState({
        status: 'playing',
        hasStarted: true,
        questionsList: chosenQuestions,
        currentQuestionIndex: 0,
        roundAnswers: {},
        scores: initialScores
      });
    } catch (e) {
      setDebugError("Error al iniciar: " + e.message);
    }
  };

  const returnToLobby = async () => {
    if (isHost) {
      await updateDoc(doc(db, 'rooms', roomPin), { status: 'lobby', neverState: null });
    }
  };

  const forcePodium = async () => {
    await updateNeverState({ status: 'podium' });
  };

  const continueGame = async () => {
    if (gameState.currentQuestionIndex < gameState.questionsList.length - 1) {
      await updateNeverState({
        status: 'playing',
        currentQuestionIndex: gameState.currentQuestionIndex + 1,
        roundAnswers: {}
      });
    } else {
      await returnToLobby();
    }
  };

  // --- LÓGICA DE JUGADOR ---
  const handleVote = async (hasDoneIt) => {
    if (gameState.status !== 'playing') return;
    if (gameState.roundAnswers[player.id] !== undefined) return; // Ya votó

    const newAnswers = { ...gameState.roundAnswers, [player.id]: hasDoneIt };
    let updates = { roundAnswers: newAnswers };

    // Si todos han votado, auto-avanzar
    if (Object.keys(newAnswers).length >= roomData.players.length) {
      // Calcular nuevos scores
      const newScores = { ...gameState.scores };
      Object.entries(newAnswers).forEach(([pid, didIt]) => {
        if (didIt) {
          newScores[pid] = (newScores[pid] || 0) + 1;
        }
      });
      
      updates.scores = newScores;
      updates.roundAnswers = {}; // Reset para la siguiente
      
      const nextIndex = gameState.currentQuestionIndex + 1;
      if (nextIndex >= gameState.questionsList.length) {
        updates.status = 'podium';
      } else {
        updates.status = 'countdown';
        updates.nextQuestionIndex = nextIndex;
      }
    }

    await updateNeverState(updates);
  };

  // Variables UI
  const currentQuestion = gameState.questionsList[gameState.currentQuestionIndex] || '';
  const myVote = gameState.roundAnswers[player.id];
  const votesCount = Object.keys(gameState.roundAnswers || {}).length;

  // Calcular ranking
  const sortedPlayers = [...roomData.players].sort((a, b) => {
    const scoreA = gameState.scores[a.id] || 0;
    const scoreB = gameState.scores[b.id] || 0;
    return scoreB - scoreA;
  });

  return (
    <div className="app-container" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
      
      {debugError && (
        <div style={{ background: 'var(--color-accent-red)', color: 'white', padding: '16px', borderRadius: '12px', marginBottom: '16px', fontWeight: 'bold' }}>
          ATENCIÓN ERROR: {debugError}
        </div>
      )}

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ color: 'var(--color-primary)' }}>🍻 Yo Nunca Nunca</h2>
      </header>

      {/* PANTALLA: ESPERANDO */}
      {gameState.status === 'waiting' && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: '5rem', marginBottom: '20px' }}>🍻</div>
          <h3 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>El clásico de los secretos</h3>
          <p style={{ color: '#666', marginBottom: '24px' }}>
            Aparecerán afirmaciones en pantalla. Si lo has hecho, dale a "SÍ" y bebe. 
            ¡Al final veremos quién es el más pecador!
          </p>
          
          {isHost ? (
            <button className="btn-party btn-blue" onClick={startGameAsHost} style={{ fontSize: '1.5rem', padding: '20px' }}>
              ¡Empezar!
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
                <span style={{ fontWeight: 'bold' }}>Total de Preguntas:</span>
                <input 
                  type="number" min="1" max="50" value={config.totalQuestions}
                  onChange={(e) => handleConfigChange('totalQuestions', e.target.value)}
                  style={{ width: '60px', padding: '4px 8px', borderRadius: '8px', border: '1px solid #ccc', textAlign: 'center' }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* PANTALLA: JUGANDO */}
      {gameState.status === 'playing' && (
        <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ background: 'var(--color-bg)', padding: '8px 16px', borderRadius: '100px', alignSelf: 'center', marginBottom: '24px', fontWeight: 'bold', color: 'var(--color-primary)' }}>
            Pregunta {gameState.currentQuestionIndex + 1} de {gameState.questionsList.length}
          </div>

          <h2 style={{ fontSize: '2rem', color: '#666', margin: 0 }}>Yo nunca nunca...</h2>
          <h1 style={{ fontSize: '2.5rem', color: 'var(--color-text)', marginTop: '8px', marginBottom: '40px', lineHeight: '1.2' }}>
            {currentQuestion}
          </h1>

          <div style={{ flex: 1 }}></div>

          {myVote === undefined ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <button 
                className="btn-party btn-red"
                onClick={() => handleVote(true)}
                style={{ padding: '32px 16px', fontSize: '1.5rem' }}
              >
                SÍ (He bebido) 🤫
              </button>
              <button 
                className="btn-party btn-blue"
                onClick={() => handleVote(false)}
                style={{ padding: '32px 16px', fontSize: '1.5rem' }}
              >
                NO 😇
              </button>
            </div>
          ) : (
            <div style={{ background: 'var(--color-surface)', padding: '32px', borderRadius: '24px', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⏳</div>
              <h3 style={{ margin: 0, color: 'var(--color-primary)' }}>¡Voto registrado!</h3>
              <p style={{ marginTop: '8px', color: '#666' }}>Esperando al resto de pecadores...</p>
            </div>
          )}

          <div style={{ marginTop: '24px', background: 'var(--color-bg)', padding: '12px', borderRadius: '8px' }}>
            Han votado: {votesCount} / {roomData.players.length}
          </div>

          {isHost && (
            <button 
              className="btn-party"
              onClick={forcePodium} 
              style={{ marginTop: '32px', background: '#333', color: 'white', padding: '10px 20px', fontSize: '1rem' }}
            >
              Ver Podio
            </button>
          )}
        </div>
      )}

      {/* PANTALLA: CUENTA ATRÁS */}
      {gameState.status === 'countdown' && (
        <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h2 style={{ fontSize: '2rem', color: '#666', marginBottom: '24px' }}>Siguiente en...</h2>
          <motion.div 
            key={localCountdown}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{ fontSize: '8rem', fontWeight: 900, color: 'var(--color-primary)' }}
          >
            {localCountdown > 0 ? localCountdown : '¡YA!'}
          </motion.div>
        </div>
      )}

      {/* PANTALLA: RESULTADOS (PODIO) */}
      {gameState.status === 'podium' && (
        <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            <h1 style={{ color: 'var(--color-primary)', fontSize: '2rem', marginBottom: '8px' }}>🏆 PODIO DE PECADORES</h1>
            <p style={{ color: '#666', marginBottom: '32px' }}>Los que más han bebido en esta partida</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
              {sortedPlayers.map((p, index) => {
                const score = gameState.scores[p.id] || 0;
                let medal = '';
                let bg = 'var(--color-surface)';
                let color = 'var(--color-text)';
                let scale = 1;

                if (index === 0) { medal = '🥇'; bg = 'linear-gradient(135deg, #FFD700, #FDB931)'; color = '#000'; scale = 1.05; }
                else if (index === 1) { medal = '🥈'; bg = 'linear-gradient(135deg, #E0E0E0, #BDBDBD)'; color = '#000'; scale = 1.02; }
                else if (index === 2) { medal = '🥉'; bg = 'linear-gradient(135deg, #FFB75E, #ED8F03)'; color = '#fff'; scale = 1; }

                return (
                  <motion.div 
                    key={p.id}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: scale, opacity: 1 }}
                    transition={{ delay: index * 0.1 }}
                    style={{ 
                      background: bg, color: color, padding: '16px 20px', borderRadius: '16px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      fontWeight: 'bold', fontSize: index < 3 ? '1.2rem' : '1.1rem',
                      boxShadow: index < 3 ? 'var(--shadow-md)' : 'var(--shadow-sm)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: '1.8rem', flexShrink: 0 }}>{medal}</span>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.name} {p.id === player.id ? '(Tú)' : ''}
                      </span>
                    </div>
                    <div style={{ flexShrink: 0, marginLeft: '12px', fontSize: '0.9em', opacity: 0.9, background: 'rgba(0,0,0,0.1)', padding: '4px 10px', borderRadius: '100px' }}>
                      {score} 🍷
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          <div style={{ flex: 1 }}></div>

          {isHost && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '24px' }}>
              {gameState.currentQuestionIndex < gameState.questionsList.length - 1 && (
                <button className="btn-party btn-blue" onClick={continueGame} style={{ padding: '20px', fontSize: '1.2rem' }}>
                  Continuar Partida
                </button>
              )}
              <button className="btn-party btn-red" onClick={returnToLobby} style={{ padding: '16px', fontSize: '1.2rem', background: '#333' }}>
                Volver al Lobby
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
