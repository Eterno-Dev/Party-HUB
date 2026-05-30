import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useGame } from '../contexts/GameContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { subscribeToRoom } from '../lib/roomService';

export default function WolfGame() {
  const navigate = useNavigate();
  const { roomPin, player, roomData, setRoomData } = useGame();
  const [debugError, setDebugError] = useState('');

  // Sincronización en tiempo real
  useEffect(() => {
    if (!roomPin || !player) {
      navigate('/');
      return;
    }

    const unsubscribe = subscribeToRoom(roomPin, (data) => {
      if (data.status === 'deleted') {
        navigate('/');
        return;
      }
      setRoomData(data);
      if (data.status !== 'wolf') {
        navigate(data.status === 'lobby' ? '/lobby' : `/${data.status}`);
      }
    });

    return () => unsubscribe();
  }, [roomPin, player, navigate, setRoomData]);

  const ROLE_INFO = {
    villager: { name: "Aldeano", icon: "🧑‍🌾", color: '#8B4513', desc: "No tienes poderes especiales. Solo duermes de noche y votas durante el día. ¡Intenta descubrir a los lobos antes de que te coman!" },
    wolf: { name: "Lobo", icon: "🐺", color: '#4B0082', desc: "Te despiertas cada noche junto al resto de lobos para devorar a una víctima. De día, disimula para que no te linchen." },
    witch: { name: "Bruja", icon: "🧙‍♀️", color: '#800080', desc: "Tienes una poción para salvar a la víctima de los lobos y otra para matar a alguien. Cada una tiene 1 solo uso." },
    cupid: { name: "Cupido", icon: "💘", color: '#FF1493', desc: "La primera noche elegirás a dos personas. Sus destinos se unirán: si uno muere, el otro morirá de pena al instante." },
    hunter: { name: "Cazador", icon: "🏹", color: '#2E8B57', desc: "Si mueres en cualquier momento de la partida, podrás vengarte llevándote a la persona que elijas a la tumba." },
    seer: { name: "Vidente", icon: "👁️", color: '#00CED1', desc: "Cada noche podrás ver la verdadera identidad de una persona. Guía a los aldeanos de día sin que los lobos te descubran." },
    little_girl: { name: "Niña Pequeña", icon: "👧", color: '#FF69B4', desc: "Puedes ver cómo votan los lobos por la noche. ¡Pero cuidado! Si saben quién eres, serás su próxima víctima." }
  };

  const gameState = roomData?.wolfState || { 
    status: 'waiting', 
    hasStarted: false,
    config: { wolvesCount: 1, hasWitch: true, hasCupid: false, hasHunter: false, hasSeer: true, hasLittleGirl: false },
    roles: {}, readyPlayers: [], alivePlayers: [], lovers: [], 
    witchPotions: { heal: true, kill: true },
    nightVictim: null, hunterTarget: null, votes: {}, history: []
  };

  const isHost = roomData?.players?.find(p => p.id === player?.id)?.isHost || false;
  const config = gameState.config;

  if (!roomData || roomData.status !== 'wolf') return null;

  // Monitorear condición de victoria
  useEffect(() => {
    if (!isHost || !gameState.hasStarted || gameState.status === 'game_over') return;
    
    if (gameState.alivePlayers && gameState.alivePlayers.length > 0) {
      const aliveWolves = gameState.alivePlayers.filter(pid => gameState.roles[pid] === 'wolf').length;
      const aliveVillagers = gameState.alivePlayers.length - aliveWolves;

      if (aliveWolves === 0) {
        updateWolfState({ status: 'game_over', winner: 'villagers' });
      } else if (aliveWolves >= aliveVillagers) {
        updateWolfState({ status: 'game_over', winner: 'wolves' });
      }
    }
  }, [gameState.alivePlayers, isHost, gameState.hasStarted, gameState.status]);

  const updateWolfState = async (updates) => {
    try {
      const flatUpdates = {};
      Object.keys(updates).forEach(key => {
        flatUpdates[`wolfState.${key}`] = updates[key];
      });
      await updateDoc(doc(db, 'rooms', roomPin), flatUpdates);
    } catch (e) {
      setDebugError("Error Firebase: " + e.message);
    }
  };

  const handleConfigChange = async (field, value) => {
    let val = value;
    if (field === 'wolvesCount') {
      val = parseInt(value);
      if (isNaN(val) || val < 1) return;
    }
    await updateWolfState({ config: { ...config, [field]: val } });
  };

  const startGame = async () => {
    try {
      const { wolvesCount, hasWitch, hasCupid, hasHunter, hasSeer, hasLittleGirl } = config;
      const playersPool = roomData.players.filter(p => !p.isHost).map(p => p.id);
      
      // Validar si hay suficientes jugadores
      const totalRolesNeed = wolvesCount + (hasWitch?1:0) + (hasCupid?1:0) + (hasHunter?1:0) + (hasSeer?1:0) + (hasLittleGirl?1:0);
      if (playersPool.length < totalRolesNeed) {
        setDebugError(`Se necesitan al menos ${totalRolesNeed} jugadores para esta configuración.`);
        return;
      }

      // Shuffle pool
      for (let i = playersPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playersPool[i], playersPool[j]] = [playersPool[j], playersPool[i]];
      }

      const assignedRoles = {};
      let currentIndex = 0;

      for(let i=0; i<wolvesCount; i++) {
        assignedRoles[playersPool[currentIndex++]] = 'wolf';
      }
      if(hasWitch) assignedRoles[playersPool[currentIndex++]] = 'witch';
      if(hasCupid) assignedRoles[playersPool[currentIndex++]] = 'cupid';
      if(hasHunter) assignedRoles[playersPool[currentIndex++]] = 'hunter';
      if(hasSeer) assignedRoles[playersPool[currentIndex++]] = 'seer';
      if(hasLittleGirl) assignedRoles[playersPool[currentIndex++]] = 'little_girl';

      while(currentIndex < playersPool.length) {
        assignedRoles[playersPool[currentIndex++]] = 'villager';
      }

      await updateWolfState({
        status: 'distribute_roles',
        roles: assignedRoles,
        alivePlayers: playersPool,
        hasStarted: true,
        readyPlayers: []
      });
      setDebugError('');
    } catch (e) {
      setDebugError("Error asignando roles: " + e.message);
    }
  };

  const returnToLobby = async () => {
    if (isHost) {
      await updateDoc(doc(db, 'rooms', roomPin), { status: 'lobby', wolfState: null });
    }
  };

  const amIAlive = gameState.alivePlayers?.includes(player.id) || false;
  const myRole = gameState.roles ? gameState.roles[player.id] : null;
  const myRoleInfo = myRole ? ROLE_INFO[myRole] : null;

  const toggleReady = async () => {
    if (isHost) return;
    const currentReady = gameState.readyPlayers || [];
    const newReady = currentReady.includes(player.id) 
      ? currentReady.filter(id => id !== player.id)
      : [...currentReady, player.id];
    
    await updateWolfState({ readyPlayers: newReady });
  };

  const checkAllReady = async () => {
    if (isHost && gameState.readyPlayers?.length >= gameState.alivePlayers?.length) {
      await updateWolfState({ status: 'night_start', readyPlayers: [] });
    }
  };

  const isRoleAlive = (role) => {
    return gameState.alivePlayers?.some(pid => gameState.roles[pid] === role);
  };

  const getNextNightPhase = (currentPhase) => {
    const phases = ['night_start'];
    if (config.hasCupid && (!gameState.lovers || gameState.lovers.length === 0)) phases.push('night_cupid');
    if (config.hasSeer && isRoleAlive('seer')) phases.push('night_seer');
    
    if (isRoleAlive('wolf')) phases.push('night_wolves');
    else phases.push('day_reveal');

    if (config.hasWitch && isRoleAlive('witch')) phases.push('night_witch');
    phases.push('day_reveal');

    const currentIndex = phases.indexOf(currentPhase);
    return phases[currentIndex + 1] || 'day_reveal';
  };

  const transitionToPhase = async (nextPhase, extraUpdates = {}) => {
    let updates = { ...extraUpdates, status: nextPhase, votes: {} };

    if (nextPhase === 'day_reveal') {
      let deaths = new Set();
      // Usar datos entrantes o los que ya hay en gameState
      const victim = updates.nightVictim !== undefined ? updates.nightVictim : gameState.nightVictim;
      const wKill = updates.witchKillTarget !== undefined ? updates.witchKillTarget : gameState.witchKillTarget;
      
      if (victim) deaths.add(victim);
      if (wKill) deaths.add(wKill);

      // Enamorados
      const lovers = updates.lovers || gameState.lovers;
      if (lovers && lovers.length === 2) {
        if (deaths.has(lovers[0])) deaths.add(lovers[1]);
        if (deaths.has(lovers[1])) deaths.add(lovers[0]);
      }

      updates.lastNightDeaths = Array.from(deaths);
      updates.alivePlayers = gameState.alivePlayers.filter(pid => !deaths.has(pid));
      
      // Limpiamos victimas de la noche
      updates.nightVictim = null;
      updates.witchKillTarget = null;
    }

    await updateWolfState(updates);
  };

  const advanceNight = async () => {
    const next = getNextNightPhase(gameState.status);
    await transitionToPhase(next);
  };

  const handleWolfVote = async (targetId) => {
    if (myRole !== 'wolf') return;
    const newVotes = { ...(gameState.votes || {}), [player.id]: targetId };

    // Check unanimity
    const aliveWolves = gameState.alivePlayers.filter(pid => gameState.roles[pid] === 'wolf');
    const votedTargets = aliveWolves.map(wid => newVotes[wid]).filter(Boolean);
    
    if (votedTargets.length === aliveWolves.length && new Set(votedTargets).size === 1) {
      const victim = votedTargets[0];
      const next = getNextNightPhase('night_wolves');
      await transitionToPhase(next, { nightVictim: victim });
    } else {
      await updateWolfState({ votes: newVotes });
    }
  };

  const handleSeerPick = async (targetId) => {
    if (myRole !== 'seer') return;
    await updateWolfState({ [`seerVision_${targetId}`]: gameState.roles[targetId] });
  };

  const handleWitchAction = async (action, targetId = null) => {
    if (myRole !== 'witch') return;
    const next = getNextNightPhase('night_witch');
    const updates = {};
    
    if (action === 'heal') {
      updates.nightVictim = null; // Save victim
      updates.witchPotions = { ...gameState.witchPotions, heal: false };
    } else if (action === 'kill' && targetId) {
      updates.witchKillTarget = targetId;
      updates.witchPotions = { ...gameState.witchPotions, kill: false };
    }
    
    await transitionToPhase(next, updates);
  };

  const handleCupidAction = async (target1, target2) => {
     if (myRole !== 'cupid') return;
     const next = getNextNightPhase('night_cupid');
     await transitionToPhase(next, { lovers: [target1, target2] });
  };

  const handleDayVote = async (targetId) => {
    if (!amIAlive) return;
    const newVotes = { ...(gameState.votes || {}), [player.id]: targetId };
    await updateWolfState({ votes: newVotes });
  };

  const calculateDayVote = async () => {
    if (!isHost) return;
    const voteCounts = {};
    Object.values(gameState.votes || {}).forEach(v => {
      voteCounts[v] = (voteCounts[v] || 0) + 1;
    });

    let maxVotes = 0;
    let victim = null;
    let tie = false;

    Object.entries(voteCounts).forEach(([pid, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        victim = pid;
        tie = false;
      } else if (count === maxVotes) {
        tie = true;
      }
    });

    if (tie || maxVotes === 0) {
      await updateWolfState({ status: 'night_start', votes: {} }); 
      return;
    }

    // Comprobamos la victoria después del linchamiento
    const newAlive = gameState.alivePlayers.filter(pid => pid !== victim);
    const hunterDied = gameState.roles[victim] === 'hunter';
    
    await updateWolfState({
      alivePlayers: newAlive,
      status: hunterDied ? 'hunter_revenge_day' : 'night_start',
      votes: {},
      lastLynched: victim
    });
  };

  const handleHunterRevenge = async (targetId, isDay) => {
    if (myRole !== 'hunter') return;
    const newAlive = gameState.alivePlayers.filter(pid => pid !== targetId);
    await updateWolfState({
      alivePlayers: newAlive,
      status: isDay ? 'night_start' : 'day_discussion',
      votes: {}
    });
  };

  // UI helpers
  const sleeping = !isHost && (
    gameState.status === 'night_start' ||
    (gameState.status === 'night_cupid' && myRole !== 'cupid') ||
    (gameState.status === 'night_seer' && myRole !== 'seer') ||
    (gameState.status === 'night_wolves' && myRole !== 'wolf' && myRole !== 'little_girl') ||
    (gameState.status === 'night_witch' && myRole !== 'witch')
  );

  return (
    <div className="app-container" style={{ padding: '20px', display: 'flex', flexDirection: 'column' }}>
      {debugError && (
        <div style={{ background: 'var(--color-accent-red)', color: 'white', padding: '16px', borderRadius: '12px', marginBottom: '16px', fontWeight: 'bold' }}>
          {debugError}
        </div>
      )}

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ color: '#4B0082' }}>🐺 El Lobo</h2>
        {!isHost && gameState.hasStarted && (
          <div style={{ background: 'var(--color-surface)', padding: '4px 12px', borderRadius: '100px', fontWeight: 900 }}>
            {amIAlive ? '💖 VIVO' : '💀 MUERTO'}
          </div>
        )}
      </header>

      {/* PANTALLA DE ESPERA Y CONFIGURACIÓN */}
      {gameState.status === 'waiting' && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '4rem', marginBottom: '10px' }}>🌕</div>
          <h3 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>Pueblo de Castronegro</h3>
          
          <div style={{ flex: 1 }}></div>

          {isHost ? (
            <div style={{ textAlign: 'left', background: 'var(--color-surface)', padding: '16px', borderRadius: '12px', boxShadow: 'var(--shadow-sm)', marginBottom: '24px' }}>
              <h4 style={{ marginBottom: '16px', color: 'var(--color-primary)' }}>⚙️ Configuración (Solo Host / Narrador)</h4>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontWeight: 'bold' }}>Número de Lobos 🐺:</span>
                <input 
                  type="number" min="1" max="10" value={config.wolvesCount}
                  onChange={(e) => handleConfigChange('wolvesCount', e.target.value)}
                  style={{ width: '60px', padding: '4px', borderRadius: '8px', border: '1px solid #ccc', textAlign: 'center' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>Bruja 🧙‍♀️:</span>
                <input type="checkbox" checked={config.hasWitch} onChange={(e) => handleConfigChange('hasWitch', e.target.checked)} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>Vidente 👁️:</span>
                <input type="checkbox" checked={config.hasSeer} onChange={(e) => handleConfigChange('hasSeer', e.target.checked)} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>Niña Pequeña 👧:</span>
                <input type="checkbox" checked={config.hasLittleGirl} onChange={(e) => handleConfigChange('hasLittleGirl', e.target.checked)} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>Cazador 🏹:</span>
                <input type="checkbox" checked={config.hasHunter} onChange={(e) => handleConfigChange('hasHunter', e.target.checked)} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>Cupido 💘:</span>
                <input type="checkbox" checked={config.hasCupid} onChange={(e) => handleConfigChange('hasCupid', e.target.checked)} />
              </div>

              <button className="btn-party btn-blue" onClick={startGame} style={{ marginTop: '24px', width: '100%', fontSize: '1.2rem', padding: '16px' }}>
                Repartir Roles
              </button>
            </div>
          ) : (
            <div style={{ background: 'var(--color-bg)', padding: '20px', borderRadius: '12px', marginBottom: '24px' }}>
              <p style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>El Narrador está preparando el pueblo...</p>
              <p style={{ color: '#666', marginTop: '8px' }}>Serás un aldeano u otro rol especial cuando caiga la noche.</p>
            </div>
          )}
        </div>
      )}

      {/* PANTALLA: REPARTO DE ROLES */}
      {gameState.status === 'distribute_roles' && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column' }}>
          {isHost ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: '4rem', marginBottom: '10px' }}>👁️</div>
              <h2 style={{ color: 'var(--color-primary)', marginBottom: '16px' }}>Los habitantes despiertan...</h2>
              <p style={{ color: '#666', marginBottom: '24px' }}>
                Cada jugador está viendo su rol en secreto en su móvil.
              </p>
              
              <div style={{ background: 'var(--color-bg)', padding: '16px', borderRadius: '12px', marginBottom: '32px' }}>
                <p style={{ fontWeight: 'bold' }}>
                  Listos: {gameState.readyPlayers?.length || 0} / {gameState.alivePlayers?.length || 0}
                </p>
              </div>

              {gameState.readyPlayers?.length >= gameState.alivePlayers?.length ? (
                <button className="btn-party btn-blue" onClick={checkAllReady} style={{ padding: '20px', fontSize: '1.2rem', animation: 'pulse 1s infinite alternate' }}>
                  Comenzar la Noche 🌙
                </button>
              ) : (
                <p style={{ color: 'var(--color-accent-red)' }}>Esperando a que todos entiendan su rol...</p>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
              <motion.div 
                initial={{ scale: 0.5, opacity: 0, rotateY: 90 }}
                animate={{ scale: 1, opacity: 1, rotateY: 0 }}
                transition={{ duration: 0.6 }}
                style={{ 
                  background: myRoleInfo?.color || '#333', 
                  color: 'white', 
                  padding: '32px', 
                  borderRadius: '24px', 
                  boxShadow: '0 10px 20px rgba(0,0,0,0.3)',
                  marginBottom: '32px',
                  maxWidth: '300px'
                }}
              >
                <div style={{ fontSize: '5rem', marginBottom: '16px' }}>{myRoleInfo?.icon}</div>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '16px' }}>{myRoleInfo?.name}</h1>
                <p style={{ fontSize: '1.1rem', lineHeight: '1.5', opacity: 0.9 }}>
                  {myRoleInfo?.desc}
                </p>
              </motion.div>

              <button 
                className={`btn-party ${gameState.readyPlayers?.includes(player.id) ? 'btn-green' : 'btn-blue'}`}
                onClick={toggleReady}
                style={{ padding: '16px', fontSize: '1.2rem', width: '100%', maxWidth: '300px' }}
              >
                {gameState.readyPlayers?.includes(player.id) ? '✅ ¡ESTOY LISTO!' : '¡ENTENDIDO!'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* PANTALLA: NOCHE (HOST) */}
      {isHost && gameState.status.startsWith('night_') && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '4rem', marginBottom: '16px' }}>🌙</div>
          <h2 style={{ color: 'var(--color-primary)', marginBottom: '24px' }}>Fase de Noche</h2>
          
          <div style={{ background: '#222', color: 'white', padding: '24px', borderRadius: '16px', fontSize: '1.2rem', marginBottom: '32px', borderLeft: '8px solid var(--color-primary)' }}>
            <p style={{ fontWeight: 'bold', color: '#aaa', fontSize: '0.9rem', marginBottom: '8px', textTransform: 'uppercase' }}>Teleprónter (Lee en voz alta)</p>
            {gameState.status === 'night_start' && <p>Narrador: "Cae la noche. El pueblo entero duerme y todos cierran los ojos..."</p>}
            {gameState.status === 'night_cupid' && <p>Narrador: "Cupido despierta. Elige a dos amantes para unirlos hasta la muerte."</p>}
            {gameState.status === 'night_seer' && <p>Narrador: "La Vidente despierta. Elige a alguien para descubrir su verdadera identidad."</p>}
            {gameState.status === 'night_wolves' && <p>Narrador: "Los Lobos despiertan y se reconocen. Deciden juntos a quién devorar esta noche."</p>}
            {gameState.status === 'night_witch' && <p>Narrador: "La Bruja despierta. Sabe quién ha sido atacado y decide si usar sus pociones."</p>}
          </div>

          <div style={{ flex: 1 }}></div>

          <button className="btn-party btn-blue" onClick={advanceNight} style={{ padding: '20px', fontSize: '1.2rem' }}>
            {gameState.status === 'night_start' ? 'Empezar Rondas' : 'Siguiente Fase / Forzar Avance'}
          </button>
        </div>
      )}

      {/* PANTALLA: NOCHE (JUGADORES DORMIDOS) */}
      {sleeping && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', background: '#111', color: '#555' }}>
          <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 3, repeat: Infinity }}>
            <div style={{ fontSize: '6rem', marginBottom: '16px' }}>💤</div>
            <h2 style={{ fontSize: '2rem' }}>Zzz...</h2>
          </motion.div>
          <p style={{ marginTop: '24px' }}>El pueblo duerme. No abras los ojos.</p>
        </div>
      )}

      {/* PANTALLA: CUPIDO */}
      {gameState.status === 'night_cupid' && myRole === 'cupid' && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', background: '#FF1493', color: 'white' }}>
          <h2 style={{ color: 'white', marginBottom: '16px' }}>💘 Flecha de Cupido</h2>
          <p style={{ color: 'rgba(255,255,255,0.8)', marginBottom: '24px' }}>Selecciona a dos jugadores para enamorarlos.</p>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', overflowY: 'auto', flex: 1 }}>
            {gameState.alivePlayers?.map(pid => {
              const playerObj = roomData.players.find(p => p.id === pid);
              const isSelected = gameState.votes?.[player.id]?.includes(pid);
              
              return (
                <div key={pid} onClick={() => {
                  const currentPicks = gameState.votes?.[player.id] || [];
                  let newPicks = [...currentPicks];
                  if (newPicks.includes(pid)) newPicks = newPicks.filter(id => id !== pid);
                  else if (newPicks.length < 2) newPicks.push(pid);
                  updateWolfState({ votes: { ...gameState.votes, [player.id]: newPicks } });
                }}
                     style={{ 
                       background: isSelected ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)', 
                       padding: '16px', borderRadius: '12px', cursor: 'pointer',
                       display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                       border: isSelected ? '2px solid white' : 'none'
                     }}>
                  <span style={{ fontWeight: 'bold' }}>{playerObj?.name}</span>
                  {isSelected && <span style={{ fontSize: '1.2rem' }}>💘</span>}
                </div>
              );
            })}
          </div>
          {(gameState.votes?.[player.id]?.length === 2) && (
            <button className="btn-party" style={{ background: 'white', color: '#FF1493', marginTop: '16px' }}
                    onClick={() => handleCupidAction(gameState.votes[player.id][0], gameState.votes[player.id][1])}>
              Unir sus destinos
            </button>
          )}
        </div>
      )}

      {/* PANTALLA: LOBOS (Y Niña Pequeña) */}
      {gameState.status === 'night_wolves' && (myRole === 'wolf' || myRole === 'little_girl') && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', background: '#2C001E', color: 'white' }}>
          <h2 style={{ color: 'var(--color-accent-red)', marginBottom: '16px' }}>
            {myRole === 'wolf' ? '🐺 Decidid a quién devorar' : '👧 Espiando a los lobos...'}
          </h2>
          <p style={{ color: '#aaa', marginBottom: '24px' }}>
            {myRole === 'wolf' ? 'Debéis votar todos a la misma persona para matarla.' : '¡Cuidado! Estás viendo lo que hacen los lobos en secreto.'}
          </p>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', overflowY: 'auto', flex: 1 }}>
            {gameState.alivePlayers?.map(pid => {
              if (gameState.roles[pid] === 'wolf' && myRole === 'wolf') return null; // No pueden comerse a sí mismos (o sí, pero mejor no)
              const playerObj = roomData.players.find(p => p.id === pid);
              const votesForThis = Object.entries(gameState.votes || {}).filter(([voterId, targetId]) => targetId === pid).map(([vId]) => roomData.players.find(p => p.id === vId)?.name);
              const isMyVote = gameState.votes?.[player.id] === pid;
              
              return (
                <div key={pid} onClick={() => myRole === 'wolf' && handleWolfVote(pid)}
                     style={{ 
                       background: isMyVote ? 'var(--color-accent-red)' : 'rgba(255,255,255,0.1)', 
                       padding: '16px', borderRadius: '12px', cursor: myRole === 'wolf' ? 'pointer' : 'default',
                       display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                     }}>
                  <span style={{ fontWeight: 'bold' }}>{playerObj?.name}</span>
                  {votesForThis.length > 0 && (
                    <span style={{ fontSize: '0.8rem', background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '100px' }}>
                      {votesForThis.length} 🐺
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PANTALLA: VIDENTE */}
      {gameState.status === 'night_seer' && myRole === 'seer' && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', background: '#002B36', color: 'white' }}>
          <h2 style={{ color: 'var(--color-primary)', marginBottom: '16px' }}>👁️ Visión de la Vidente</h2>
          <p style={{ color: '#aaa', marginBottom: '24px' }}>Selecciona a un jugador para descubrir su verdadera identidad.</p>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', overflowY: 'auto', flex: 1 }}>
            {gameState.alivePlayers?.filter(pid => pid !== player.id).map(pid => {
              const playerObj = roomData.players.find(p => p.id === pid);
              const discoveredRole = gameState[`seerVision_${pid}`];
              
              return (
                <div key={pid} onClick={() => !discoveredRole && handleSeerPick(pid)}
                     style={{ 
                       background: discoveredRole ? 'rgba(0,255,0,0.2)' : 'rgba(255,255,255,0.1)', 
                       padding: '16px', borderRadius: '12px', cursor: discoveredRole ? 'default' : 'pointer',
                       display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                     }}>
                  <span style={{ fontWeight: 'bold' }}>{playerObj?.name}</span>
                  {discoveredRole && (
                    <span style={{ fontSize: '1.2rem' }}>{ROLE_INFO[discoveredRole]?.icon} {ROLE_INFO[discoveredRole]?.name}</span>
                  )}
                </div>
              );
            })}
          </div>
          {Object.keys(gameState).some(k => k.startsWith('seerVision_')) && (
            <button className="btn-party btn-blue" onClick={() => transitionToPhase(getNextNightPhase('night_seer'))} style={{ marginTop: '16px' }}>
              Terminar Visión
            </button>
          )}
        </div>
      )}

      {/* PANTALLA: BRUJA */}
      {gameState.status === 'night_witch' && myRole === 'witch' && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', background: '#1B003A', color: 'white' }}>
          <h2 style={{ color: 'var(--color-primary)', marginBottom: '16px' }}>🧙‍♀️ Elige tus Pociones</h2>
          
          <div style={{ background: 'rgba(255,0,0,0.2)', padding: '16px', borderRadius: '12px', marginBottom: '24px' }}>
            <p>Los lobos han atacado a:</p>
            <h3 style={{ color: 'var(--color-accent-red)', fontSize: '1.5rem', margin: '8px 0' }}>
              {gameState.nightVictim ? roomData.players.find(p => p.id === gameState.nightVictim)?.name : 'NADIE'}
            </h3>
          </div>

          <div style={{ flex: 1 }}>
            {gameState.witchPotions?.heal && gameState.nightVictim && (
              <button className="btn-party btn-green" onClick={() => handleWitchAction('heal')} style={{ width: '100%', padding: '20px', marginBottom: '16px' }}>
                🧪 Usar Poción de Vida (Salvar)
              </button>
            )}
            
            {gameState.witchPotions?.kill && (
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '16px', borderRadius: '12px' }}>
                <p style={{ marginBottom: '12px' }}>🧪 Usar Poción de Muerte en:</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {gameState.alivePlayers?.filter(pid => pid !== player.id).map(pid => (
                    <button key={pid} onClick={() => handleWitchAction('kill', pid)} style={{ padding: '8px', background: 'var(--color-accent-red)', color: 'white', border: 'none', borderRadius: '8px' }}>
                      {roomData.players.find(p => p.id === pid)?.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button className="btn-party" onClick={() => handleWitchAction('none')} style={{ background: '#555', color: 'white', padding: '16px', marginTop: '16px' }}>
            No hacer nada
          </button>
        </div>
      )}

      {/* PANTALLA: DÍA (REVELACIÓN DE MUERTES) */}
      {gameState.status === 'day_reveal' && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '4rem', marginBottom: '16px' }}>☀️</div>
          <h2 style={{ color: 'var(--color-primary)', marginBottom: '16px' }}>Amanece en Castronegro</h2>
          
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {(!gameState.lastNightDeaths || gameState.lastNightDeaths.length === 0) ? (
              <div style={{ background: 'rgba(0,255,0,0.1)', padding: '24px', borderRadius: '16px' }}>
                <h3 style={{ color: 'var(--color-accent-green)', fontSize: '1.5rem' }}>¡Nadie ha muerto esta noche!</h3>
                <p style={{ marginTop: '12px' }}>El pueblo celebra que todos siguen vivos.</p>
              </div>
            ) : (
              <div style={{ background: 'rgba(255,0,0,0.1)', padding: '24px', borderRadius: '16px' }}>
                <h3 style={{ color: 'var(--color-accent-red)', fontSize: '1.5rem', marginBottom: '16px' }}>Muertes de esta noche:</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {gameState.lastNightDeaths.map(pid => {
                    const pName = roomData.players.find(p => p.id === pid)?.name;
                    const pRole = gameState.roles[pid];
                    return (
                      <div key={pid} style={{ background: 'var(--color-surface)', padding: '12px', borderRadius: '8px', fontWeight: 'bold' }}>
                        💀 {pName} <span style={{ color: '#888', fontSize: '0.9rem', marginLeft: '8px' }}>({ROLE_INFO[pRole]?.name})</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {isHost && (
            <button className="btn-party btn-blue" style={{ marginTop: '24px', padding: '16px', fontSize: '1.2rem' }}
                    onClick={() => {
                      const hunterDied = gameState.lastNightDeaths?.some(pid => gameState.roles[pid] === 'hunter');
                      updateWolfState({ status: hunterDied ? 'hunter_revenge_night' : 'day_discussion' });
                    }}>
              Continuar a Discusión
            </button>
          )}
        </div>
      )}

      {/* PANTALLA: DÍA (DISCUSIÓN Y VOTACIÓN) */}
      {(gameState.status === 'day_discussion' || gameState.status === 'day_voting') && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ color: 'var(--color-primary)', marginBottom: '16px' }}>
            {gameState.status === 'day_discussion' ? '🗣️ Momento de Hablar' : '🗳️ Votación del Pueblo'}
          </h2>
          <p style={{ color: '#666', marginBottom: '24px' }}>
            {gameState.status === 'day_discussion' ? 'Discutid quién creéis que es el lobo.' : 'Votad para linchar a un sospechoso. ¡El que tenga más votos morirá!'}
          </p>

          {gameState.status === 'day_discussion' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: '5rem', animation: 'bounce 2s infinite' }}>⚖️</div>
              {isHost && (
                <button className="btn-party btn-red" style={{ marginTop: '32px', padding: '16px', fontSize: '1.2rem' }}
                        onClick={() => updateWolfState({ status: 'day_voting', votes: {} })}>
                  Comenzar Linchamiento
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', overflowY: 'auto', flex: 1 }}>
              {gameState.alivePlayers?.map(pid => {
                const playerObj = roomData.players.find(p => p.id === pid);
                const votesForThis = Object.entries(gameState.votes || {}).filter(([voterId, targetId]) => targetId === pid).map(([vId]) => roomData.players.find(p => p.id === vId)?.name);
                const isMyVote = gameState.votes?.[player.id] === pid;
                
                return (
                  <div key={pid} onClick={() => amIAlive && handleDayVote(pid)}
                       style={{ 
                         background: isMyVote ? 'var(--color-accent-red)' : 'var(--color-surface)', 
                         color: isMyVote ? 'white' : 'inherit',
                         padding: '16px', borderRadius: '12px', cursor: amIAlive ? 'pointer' : 'default',
                         display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                       }}>
                    <span style={{ fontWeight: 'bold' }}>{playerObj?.name}</span>
                    {votesForThis.length > 0 && (
                      <span style={{ fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '100px' }}>
                        {votesForThis.length} votos
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {isHost && gameState.status === 'day_voting' && (
            <button className="btn-party btn-blue" style={{ marginTop: '24px', padding: '16px', fontSize: '1.2rem' }}
                    onClick={calculateDayVote}>
              Ejecutar al más votado
            </button>
          )}
        </div>
      )}

      {/* PANTALLA: VENGANZA DEL CAZADOR */}
      {(gameState.status === 'hunter_revenge_night' || gameState.status === 'hunter_revenge_day') && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', background: '#2E8B57', color: 'white' }}>
          <h2 style={{ marginBottom: '16px' }}>🏹 Venganza del Cazador</h2>
          
          {myRole === 'hunter' ? (
            <>
              <p style={{ marginBottom: '24px' }}>Has muerto. Pero puedes llevarte a alguien contigo a la tumba. ¡Dispara!</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', overflowY: 'auto', flex: 1 }}>
                {gameState.alivePlayers?.filter(pid => pid !== player.id).map(pid => (
                  <button key={pid} onClick={() => handleHunterRevenge(pid, gameState.status === 'hunter_revenge_day')} 
                          style={{ padding: '16px', background: 'rgba(255,255,255,0.2)', color: 'white', border: 'none', borderRadius: '12px', fontSize: '1.2rem', cursor: 'pointer' }}>
                    🎯 Disparar a {roomData.players.find(p => p.id === pid)?.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <p style={{ fontSize: '1.2rem' }}>El Cazador ha muerto, pero antes de caer levantó su escopeta...</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '16px', animation: 'pulse 1s infinite alternate' }}>El Cazador está decidiendo a quién disparar.</p>
            </div>
          )}
        </div>
      )}

      {/* PANTALLA: GAME OVER */}
      {gameState.status === 'game_over' && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', background: gameState.winner === 'villagers' ? '#2E8B57' : '#2C001E', color: 'white' }}>
          <div style={{ fontSize: '5rem', marginBottom: '16px' }}>
            {gameState.winner === 'villagers' ? '🧑‍🌾' : '🐺'}
          </div>
          <h2 style={{ fontSize: '2.5rem', marginBottom: '16px' }}>
            {gameState.winner === 'villagers' ? '¡El Pueblo Gana!' : '¡Los Lobos Ganan!'}
          </h2>
          <p style={{ fontSize: '1.2rem', marginBottom: '24px', opacity: 0.9 }}>
            {gameState.winner === 'villagers' 
              ? 'Todos los lobos han sido eliminados. La paz vuelve a Castronegro.' 
              : 'Los lobos han superado en número a los aldeanos y han devorado el pueblo entero.'}
          </p>

          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '16px', flex: 1, overflowY: 'auto', textAlign: 'left' }}>
            <h3 style={{ marginBottom: '16px', textAlign: 'center' }}>Roles de la Partida</h3>
            {roomData.players.filter(p => !p.isHost).map(p => {
              const r = gameState.roles[p.id];
              const isAlive = gameState.alivePlayers?.includes(p.id);
              return (
                <div key={p.id} style={{ padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    {ROLE_INFO[r]?.icon} <span style={{ fontWeight: 'bold' }}>{p.name}</span>
                    <span style={{ fontSize: '0.8rem', opacity: 0.7, marginLeft: '8px' }}>({ROLE_INFO[r]?.name})</span>
                  </span>
                  <span>{isAlive ? '💖' : '💀'}</span>
                </div>
              );
            })}
          </div>

          {isHost && (
            <button className="btn-party" style={{ background: 'white', color: 'black', marginTop: '24px', padding: '16px' }}
                    onClick={returnToLobby}>
              Volver al Lobby
            </button>
          )}
        </div>
      )}

      {/* ESTADOS EN CONSTRUCCIÓN */}
      {gameState.status !== 'waiting' && gameState.status !== 'distribute_roles' && gameState.status !== 'day_reveal' && gameState.status !== 'day_discussion' && gameState.status !== 'day_voting' && !gameState.status.startsWith('hunter_') && !gameState.status.startsWith('night_') && gameState.status !== 'game_over' && (
        <div className="card" style={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h2>Estado actual: {gameState.status}</h2>
          {isHost && (
            <button className="btn-party btn-red" onClick={returnToLobby} style={{ marginTop: '24px' }}>
              Forzar fin (Volver al Lobby)
            </button>
          )}
        </div>
      )}

    </div>
  );
}
