import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGame } from '../contexts/GameContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { subscribeToRoom } from '../lib/roomService';

const BOMB_TOPICS = [
  "Marcas de coches", "Países de Europa", "Animales salvajes", "Colores", 
  "Marcas de ropa", "Nombres de mujer", "Nombres de hombre", "Instrumentos musicales", 
  "Películas famosas", "Frutas", "Verduras", "Equipos de fútbol", "Superhéroes", 
  "Profesiones", "Cosas que se pueden enchufar", "Tipos de baile"
];

export default function BombGame() {
  const navigate = useNavigate();
  const { roomPin, player, roomData, setRoomData } = useGame();
  const timerRef = useRef(null);
  
  const [debugError, setDebugError] = useState('');
  const [uiLogs, setUiLogs] = useState([]);

  // Sincronización en tiempo real con Firebase (¡ESTO FALTABA!)
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
      if (data.status !== 'bomb') {
        navigate(data.status === 'lobby' ? '/lobby' : `/${data.status}`);
      }
    });

    return () => unsubscribe();
  }, [roomPin, player, navigate, setRoomData]);

  if (!roomData || roomData.status !== 'bomb') return null;

  const gameState = roomData.bombState || { 
    status: 'waiting', 
    lives: {}, 
    currentPlayerId: null, 
    currentTopic: null,
    deathOrder: [],
    config: { maxLives: 3, minTime: 4, maxTime: 15 }
  };
  const config = gameState.config || { maxLives: 3, minTime: 4, maxTime: 15 };

  const addLog = (msg) => setUiLogs(prev => [...prev, msg]);

  const updateBombState = async (updates) => {
    try {
      addLog("Llamando a Firebase updateDoc...");
      const flatUpdates = {};
      Object.keys(updates).forEach(key => {
        flatUpdates[`bombState.${key}`] = updates[key];
      });
      await updateDoc(doc(db, 'rooms', roomPin), flatUpdates);
      addLog("Firebase respondió OK.");
    } catch (e) {
      setDebugError("Error Firebase: " + e.message);
      addLog("Error Firebase: " + e.message);
    }
  };

  // --- LÓGICA DEL HOST ---
  const startRoundAsHost = async () => {
    try {
      setUiLogs([]); // reiniciar logs
      setDebugError(''); 
      
      let newLives = { ...gameState.lives };
      const maxLives = config.maxLives;
      
      roomData.players.forEach(p => {
        if (newLives[p.id] === undefined) {
          newLives[p.id] = maxLives;
        }
      });

      const alivePlayers = roomData.players.filter(p => newLives[p.id] > 0);
      
      if (alivePlayers.length <= 1) {
        await updateBombState({ status: 'game_over', winnerId: alivePlayers[0]?.id || null });
        return;
      }

      const firstPlayer = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
      const randomTopic = BOMB_TOPICS[Math.floor(Math.random() * BOMB_TOPICS.length)] || "Tema Aleatorio";

      await updateBombState({
        status: 'playing',
        lives: newLives,
        currentPlayerId: firstPlayer.id,
        currentTopic: randomTopic,
        hasStarted: true
      });

      // Temporizador secreto del host
      const minMs = config.minTime * 1000;
      const maxMs = config.maxTime * 1000;
      const timeToExplode = Math.floor(Math.random() * (maxMs - minMs + 1000)) + minMs;
      
      if (timerRef.current) clearTimeout(timerRef.current);
      
      timerRef.current = setTimeout(async () => {
        try {
          await updateBombState({ status: 'exploded' });
        } catch (err) {
          setDebugError("Error al explotar: " + err.message);
        }
      }, timeToExplode);
    } catch (error) {
      setDebugError("Error JS Interno: " + error.message);
    }
  };

  const handleExplosionEndAsHost = async () => {
    const updatedLives = { ...gameState.lives };
    const newDeathOrder = [...(gameState.deathOrder || [])];

    if (updatedLives[gameState.currentPlayerId] > 0) {
      updatedLives[gameState.currentPlayerId] -= 1;

      if (updatedLives[gameState.currentPlayerId] === 0) {
        newDeathOrder.push(gameState.currentPlayerId);
      }
    }
    
    await updateBombState({
      status: 'waiting',
      lives: updatedLives,
      deathOrder: newDeathOrder,
      currentTopic: null
    });
  };

  // --- LÓGICA DE JUGADORES ---
  const passBomb = async () => {
    try {
      if (gameState.currentPlayerId !== player.id || gameState.status !== 'playing') return;
      
      const alivePlayers = roomData.players.filter(p => gameState.lives[p.id] > 0);
      const currentIndex = alivePlayers.findIndex(p => p.id === player.id);
      let nextIndex = currentIndex + 1;
      if (nextIndex >= alivePlayers.length) nextIndex = 0;
      
      await updateBombState({
        currentPlayerId: alivePlayers[nextIndex].id
      });
    } catch (e) {
      setDebugError("Error JS al pasar: " + e.message);
    }
  };

  const returnToLobby = async () => {
    const isHost = roomData.players.find(p => p.id === player.id)?.isHost;
    if (isHost) {
      await updateDoc(doc(db, 'rooms', roomPin), { status: 'lobby', bombState: null });
    }
  };

  // UI Renders
  const isHost = roomData.players.find(p => p.id === player.id)?.isHost || false;
  const isMyTurn = gameState.currentPlayerId === player.id;
  const myLives = gameState.lives[player.id] !== undefined ? gameState.lives[player.id] : '-';
  const amIAlive = myLives > 0 || myLives === '-';
  
  const currentPlayer = roomData.players.find(p => p.id === gameState.currentPlayerId);

  // Calcular ranking para el podio (solo se usa en game_over)
  const sortedPlayers = [...roomData.players].sort((a, b) => {
    const livesA = gameState.lives[a.id] || 0;
    const livesB = gameState.lives[b.id] || 0;
    
    if (livesA !== livesB) {
      return livesB - livesA; // Más vidas primero
    }
    
    // Si ambos tienen 0 vidas, mirar quién murió más tarde
    if (livesA === 0) {
      const deathA = (gameState.deathOrder || []).indexOf(a.id);
      const deathB = (gameState.deathOrder || []).indexOf(b.id);
      return deathB - deathA; // El que tenga índice mayor va primero
    }
    
    return 0;
  });

  const aliveCount = Object.values(gameState.lives || {}).filter(l => l > 0).length;

  const handleConfigChange = async (field, value) => {
    let val = parseInt(value);
    if (isNaN(val)) return;
    
    // Validaciones básicas
    if (field === 'maxLives' && (val < 1 || val > 10)) return;
    if (field === 'minTime' && (val < 2 || val >= config.maxTime)) return;
    if (field === 'maxTime' && (val <= config.minTime || val > 60)) return;

    await updateBombState({ config: { ...config, [field]: val } });
  };

  return (
    <div className="app-container" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
      
      {debugError && (
        <div style={{ background: 'var(--color-accent-red)', color: 'white', padding: '16px', borderRadius: '12px', marginBottom: '16px', fontWeight: 'bold' }}>
          ATENCIÓN ERROR: {debugError}
        </div>
      )}

      {/* Visor de Logs Oculto temporalmente, pero el código sigue ahí 
      {uiLogs.length > 0 && (
        <div style={{ background: '#333', color: '#0f0', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontFamily: 'monospace', fontSize: '0.8rem', textAlign: 'left' }}>
          <strong>LOGS DE EJECUCIÓN:</strong>
          {uiLogs.map((log, idx) => <div key={idx}>{'>'} {log}</div>)}
        </div>
      )}
      */}

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ color: 'var(--color-primary)' }}>💣 La Bomba</h2>
        <div style={{ background: 'var(--color-surface)', padding: '4px 12px', borderRadius: '100px', fontWeight: 900 }}>
          Vidas: <span style={{ color: myLives <= 1 ? 'red' : 'green' }}>{myLives}</span> ❤️
        </div>
      </header>

      {/* Mostrar el Tema Gigante si estamos jugando */}
      {gameState.currentTopic && (
        <div style={{ background: 'var(--color-surface)', padding: '16px', borderRadius: '16px', textAlign: 'center', boxShadow: 'var(--shadow-md)', marginBottom: '1rem' }}>
          <p style={{ color: '#666', fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '4px' }}>TEMA ACTUAL</p>
          <h1 style={{ color: 'var(--color-primary)', fontSize: '2rem', lineHeight: '1.2' }}>{gameState.currentTopic}</h1>
        </div>
      )}

      {/* PANTALLA: ESPERANDO */}
      {gameState.status === 'waiting' && (
        <div className="card" style={{ textAlign: 'center', flex: 1 }}>
          <h3 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>¿Listos?</h3>
          <p style={{ color: '#666' }}>Di una palabra del tema que toque y dale a PASAR.</p>
          
          {isHost ? (
            <button 
              className="btn-party btn-red" 
              onClick={startRoundAsHost} 
              style={{ marginTop: '24px', width: '100%', fontSize: '1.5rem', padding: '20px' }}
            >
              ¡Comenzar Partida!
            </button>
          ) : (
            <div style={{ background: 'var(--color-bg)', padding: '20px', borderRadius: '12px', marginTop: '24px' }}>
              <p style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>El anfitrión está a punto de lanzar la bomba...</p>
            </div>
          )}

          {/* Configuración de sala (Solo Host) */}
          {isHost && !gameState.hasStarted && (
            <div style={{ marginTop: '32px', textAlign: 'left', background: 'var(--color-surface)', padding: '16px', borderRadius: '12px', boxShadow: 'var(--shadow-sm)' }}>
              <h4 style={{ marginBottom: '16px', color: 'var(--color-primary)' }}>⚙️ Configuración de la Partida</h4>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontWeight: 'bold' }}>Vidas por jugador:</span>
                <input 
                  type="number" min="1" max="8" value={config.maxLives}
                  onChange={(e) => handleConfigChange('maxLives', e.target.value)}
                  style={{ width: '60px', padding: '4px 8px', borderRadius: '8px', border: '1px solid #ccc', textAlign: 'center' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontWeight: 'bold' }}>Tiempo Mínimo (s):</span>
                <input 
                  type="number" min="2" max={config.maxTime - 1} value={config.minTime}
                  onChange={(e) => handleConfigChange('minTime', e.target.value)}
                  style={{ width: '60px', padding: '4px 8px', borderRadius: '8px', border: '1px solid #ccc', textAlign: 'center' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold' }}>Tiempo Máximo (s):</span>
                <input 
                  type="number" min={config.minTime + 1} max="60" value={config.maxTime}
                  onChange={(e) => handleConfigChange('maxTime', e.target.value)}
                  style={{ width: '60px', padding: '4px 8px', borderRadius: '8px', border: '1px solid #ccc', textAlign: 'center' }}
                />
              </div>
            </div>
          )}
          
          <div style={{ marginTop: '32px', textAlign: 'left', background: 'var(--color-bg)', padding: '16px', borderRadius: '12px' }}>
            <h4 style={{ marginBottom: '12px' }}>Vidas de los jugadores:</h4>
            {roomData.players.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #ddd' }}>
                <span style={{ fontWeight: 'bold', textDecoration: gameState.lives[p.id] <= 0 ? 'line-through' : 'none', color: gameState.lives[p.id] <= 0 ? '#999' : 'inherit' }}>
                  {p.name}
                </span>
                <span style={{ letterSpacing: '2px' }}>
                  {gameState.lives[p.id] !== undefined ? '❤️'.repeat(gameState.lives[p.id]) : 'Esperando...'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PANTALLA: JUGANDO */}
      {gameState.status === 'playing' && (
        <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h3 style={{ marginBottom: '20px', fontSize: '1.5rem' }}>
            Turno de: <span style={{ color: 'var(--color-primary)', fontSize: '2.5rem', display: 'block', wordBreak: 'break-word' }}>{currentPlayer?.name}</span>
          </h3>

          <AnimatePresence>
            {isMyTurn ? (
              <motion.div 
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                style={{ background: 'var(--color-accent-red)', padding: '30px 20px', borderRadius: '24px', boxShadow: '0 20px 0 #900' }}
              >
                <div style={{ fontSize: '5rem', marginBottom: '10px', animation: 'pulse 0.3s infinite alternate' }}>💣</div>
                <h2 style={{ color: 'white', marginBottom: '20px', fontSize: '1.5rem' }}>¡DI UNA PALABRA Y PÁSALA!</h2>
                <button 
                  onClick={passBomb}
                  style={{ background: 'white', color: 'var(--color-accent-red)', border: 'none', padding: '24px 40px', fontSize: '2rem', fontWeight: 900, borderRadius: '16px', cursor: 'pointer', width: '100%', boxShadow: '0 8px 0 #ccc' }}
                >
                  ¡PASAR!
                </button>
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: '40px' }}>
                <div style={{ fontSize: '4rem', opacity: 0.5, animation: 'shake 1s infinite alternate' }}>💣</div>
                <p style={{ marginTop: '20px', fontWeight: 'bold', fontSize: '1.2rem', color: '#666' }}>
                  {amIAlive ? '¡Atento que te puede tocar!' : 'Estás eliminado 💀'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* PANTALLA: EXPLOTÓ */}
      {gameState.status === 'exploded' && (
        <motion.div 
          initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="card" style={{ textAlign: 'center', background: 'var(--color-accent-red)', color: 'white', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
        >
          <div style={{ fontSize: '6rem', marginBottom: '10px' }}>💥</div>
          <h1 style={{ fontSize: '3rem' }}>¡KABOOM!</h1>
          <p style={{ fontSize: '1.5rem', margin: '20px 0' }}>Le ha explotado a:<br/><strong>{currentPlayer?.name}</strong></p>
          
          {isHost && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '24px' }}>
              <button className="btn-party" onClick={handleExplosionEndAsHost} style={{ background: 'white', color: 'red', padding: '16px', fontSize: '1.5rem' }}>
                Restar Vida y Continuar
              </button>
              <button 
                className="btn-party"
                onClick={() => updateBombState({ status: 'game_over' })}
                style={{ background: '#333', color: 'white', padding: '10px 20px', fontSize: '1rem' }}
              >
                Ver Podio
              </button>
            </div>
          )}
        </motion.div>
      )}

      {/* PANTALLA: FIN DEL JUEGO (PODIO) */}
      {gameState.status === 'game_over' && (
        <div style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            <h1 style={{ color: 'var(--color-primary)', fontSize: '2rem', marginBottom: '8px' }}>🏆 PODIO DE SUPERVIVIENTES</h1>
            <p style={{ color: '#666', marginBottom: '32px' }}>Ranking de la partida</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
              {sortedPlayers.map((p, index) => {
                const lives = gameState.lives[p.id] || 0;
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
                      boxShadow: index < 3 ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                      opacity: lives === 0 && index > 2 ? 0.7 : 1
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: '1.8rem', flexShrink: 0 }}>{medal || (lives === 0 ? '💀' : '💖')}</span>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: lives === 0 ? 'line-through' : 'none' }}>
                        {p.name} {p.id === player.id ? '(Tú)' : ''}
                      </span>
                    </div>
                    <div style={{ flexShrink: 0, marginLeft: '12px', fontSize: '0.9em', background: 'rgba(0,0,0,0.1)', padding: '4px 10px', borderRadius: '100px' }}>
                      {lives} ❤️
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          <div style={{ flex: 1 }}></div>

          {isHost && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '24px' }}>
              {aliveCount > 1 && (
                <button 
                  className="btn-party btn-blue" 
                  onClick={() => updateBombState({ status: 'exploded' })} 
                  style={{ padding: '20px', fontSize: '1.2rem' }}
                >
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
      
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); }
          100% { transform: scale(1.1); }
        }
        @keyframes shake {
          0% { transform: translateX(0); }
          25% { transform: translateX(-5px) rotate(-5deg); }
          75% { transform: translateX(5px) rotate(5deg); }
          100% { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
