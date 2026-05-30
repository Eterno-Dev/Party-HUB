import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { createRoom, joinRoom } from '../lib/roomService';
import { registerUser, updateUserName, updateUserAvatarConfig } from '../lib/userService';
import { useGame } from '../contexts/GameContext';

const AVATAR_OPTIONS = {
  eyes: Array.from({length: 26}, (_, i) => `variant${String(i+1).padStart(2, '0')}`),
  mouth: Array.from({length: 30}, (_, i) => `variant${String(i+1).padStart(2, '0')}`),
  eyebrows: Array.from({length: 15}, (_, i) => `variant${String(i+1).padStart(2, '0')}`),
  glasses: ['none', ...Array.from({length: 5}, (_, i) => `variant${String(i+1).padStart(2, '0')}`)],
  skinColor: ['f2d3b1', 'ecad80', 'd49060', '9e5622', '763900']
};

const getAvatarUrl = (config) => {
  if (!config) return `https://api.dicebear.com/9.x/adventurer-neutral/svg?seed=default`;
  const base = `https://api.dicebear.com/9.x/adventurer-neutral/svg?seed=${config.seed}`;
  const params = new URLSearchParams();
  
  if (config.eyes) params.append('eyes', config.eyes);
  if (config.mouth) params.append('mouth', config.mouth);
  if (config.eyebrows) params.append('eyebrows', config.eyebrows);
  
  if (config.glasses && config.glasses !== 'none') {
    params.append('glasses', config.glasses);
    params.append('glassesProbability', '100');
  } else {
    params.append('glassesProbability', '0');
  }
  
  if (config.backgroundColor) params.append('backgroundColor', config.backgroundColor);
  
  return `${base}&${params.toString()}`;
};

const ArrowSelector = ({ label, options, value, onChange }) => {
  const currentIndex = options.indexOf(value) !== -1 ? options.indexOf(value) : 0;
  
  const handlePrev = () => {
    const nextIdx = currentIndex <= 0 ? options.length - 1 : currentIndex - 1;
    onChange(options[nextIdx]);
  };
  
  const handleNext = () => {
    const nextIdx = currentIndex >= options.length - 1 ? 0 : currentIndex + 1;
    onChange(options[nextIdx]);
  };
  
  const displayValue = value === 'none' ? 'Ninguno' : (label === 'Color de piel' ? `Tono ${options.indexOf(value) + 1}` : value.replace('variant', 'Tipo '));

  return (
    <div style={{ marginBottom: '8px', background: 'rgba(0,0,0,0.05)', padding: '6px 12px', borderRadius: '12px' }}>
      <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px', color: '#666', textAlign: 'center', fontSize: '0.8rem', textTransform: 'uppercase' }}>{label}</label>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={handlePrev} style={{ border: 'none', background: 'var(--color-primary)', color: 'white', width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem' }}>{'<'}</button>
        <span style={{ fontWeight: 'bold', fontSize: '1rem', userSelect: 'none', color: 'var(--color-text)' }}>{displayValue}</span>
        <button onClick={handleNext} style={{ border: 'none', background: 'var(--color-primary)', color: 'white', width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem' }}>{'>'}</button>
      </div>
    </div>
  );
};

export default function Home() {
  const navigate = useNavigate();
  const { player, setPlayer, roomPin, setRoomPin, loadingGlobal } = useGame();
  
  const [nameInput, setNameInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  
  const [showJoinForm, setShowJoinForm] = useState(false);

  // Avatar Editor State
  const [isEditingAvatar, setIsEditingAvatar] = useState(false);
  const [tempAvatar, setTempAvatar] = useState(null);

  useEffect(() => {
    if (player && roomPin && !loadingGlobal && !isEditingName && !isEditingAvatar) {
      navigate('/lobby');
    }
  }, [player, roomPin, loadingGlobal, isEditingName, isEditingAvatar, navigate]);

  if (loadingGlobal) {
    return <div className="app-container" style={{justifyContent: 'center', alignItems: 'center'}}><h2>Cargando perfil...</h2></div>;
  }

  // --- FLUJO DE REGISTRO / CAMBIO DE NOMBRE ---
  const handleSaveName = async () => {
    if (!nameInput) return setError('¡Escribe tu nombre!');
    setLoading(true);
    try {
      if (player) {
        await updateUserName(player.id, nameInput);
        setPlayer({ ...player, name: nameInput });
        setIsEditingName(false);
      } else {
        const newUser = await registerUser(nameInput);
        setPlayer(newUser);
      }
    } catch (err) {
      setError('Error guardando nombre: ' + err.message);
    }
    setLoading(false);
  };

  // --- FLUJO DEL EDITOR DE AVATAR ---
  const openAvatarEditor = () => {
    setTempAvatar({
      seed: player.avatarConfig?.seed || player.id,
      eyes: player.avatarConfig?.eyes === 'default' ? AVATAR_OPTIONS.eyes[0] : (player.avatarConfig?.eyes || AVATAR_OPTIONS.eyes[0]),
      mouth: player.avatarConfig?.mouth === 'default' ? AVATAR_OPTIONS.mouth[0] : (player.avatarConfig?.mouth || AVATAR_OPTIONS.mouth[0]),
      eyebrows: player.avatarConfig?.eyebrows === 'default' ? AVATAR_OPTIONS.eyebrows[0] : (player.avatarConfig?.eyebrows || AVATAR_OPTIONS.eyebrows[0]),
      glasses: player.avatarConfig?.glasses || 'none',
      backgroundColor: player.avatarConfig?.backgroundColor || AVATAR_OPTIONS.skinColor[0]
    });
    setIsEditingAvatar(true);
  };

  const saveAvatar = async () => {
    setLoading(true);
    try {
      await updateUserAvatarConfig(player.id, tempAvatar);
      setPlayer({ ...player, avatarConfig: tempAvatar });
      setIsEditingAvatar(false);
    } catch (err) {
      setError('Error guardando avatar: ' + err.message);
    }
    setLoading(false);
  };

  const handleRandomizeAvatar = () => {
    const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
    setTempAvatar({
      ...tempAvatar,
      seed: Math.random().toString(36).substring(7),
      eyes: randomItem(AVATAR_OPTIONS.eyes),
      mouth: randomItem(AVATAR_OPTIONS.mouth),
      eyebrows: randomItem(AVATAR_OPTIONS.eyebrows),
      glasses: randomItem(AVATAR_OPTIONS.glasses),
      backgroundColor: randomItem(AVATAR_OPTIONS.skinColor)
    });
  };

  // Si no está registrado o está editando el nombre
  if (!player || isEditingName) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <motion.div initial={{ scale: 0.8, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} className="card" style={{ width: '100%', textAlign: 'center' }}>
          <h1 style={{ marginBottom: '0.5rem', fontSize: '3rem', color: 'var(--color-primary)' }}>🎉 Party Hub</h1>
          <p style={{ marginBottom: '2rem', fontWeight: 600, color: '#666' }}>
            {player ? '¿Cómo te quieres llamar ahora?' : '¿Quién eres?'}
          </p>
          {error && <p style={{ color: 'var(--color-accent-red)', fontWeight: 'bold' }}>{error}</p>}
          <input 
            type="text" 
            placeholder="Tu Nombre o Apodo" 
            className="input-party"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            maxLength={12}
            style={{ marginBottom: '16px' }}
          />
          <button className="btn-party" onClick={handleSaveName} disabled={loading} style={{ width: '100%' }}>
            {player ? 'Guardar Cambios' : 'Empezar el Viaje'}
          </button>
          {player && (
            <button onClick={() => setIsEditingName(false)} style={{ background: 'none', border: 'none', color: '#888', marginTop: '16px', cursor: 'pointer', fontWeight: 'bold' }}>
              Cancelar
            </button>
          )}
        </motion.div>
      </div>
    );
  }

  // --- FLUJO DE HUB GLOBAL (Ya registrado) ---
  const handleCreate = async () => {
    setLoading(true);
    try {
      const { pin } = await createRoom(player);
      setRoomPin(pin);
      navigate('/lobby');
    } catch (err) {
      setError('Error al crear sala: ' + err.message);
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!pinInput || pinInput.length !== 4) return setError('El PIN debe ser de 4 números');
    setLoading(true);
    try {
      const { pin } = await joinRoom(pinInput, player);
      setRoomPin(pin);
      navigate('/lobby');
    } catch (err) {
      setError('Error: ' + err.message);
      setLoading(false);
    }
  };

  return (
    <div className="app-container" style={{ padding: '20px 10px', position: 'relative' }}>
      
      {/* Editor de Avatar Modal */}
      <AnimatePresence>
        {isEditingAvatar && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }} 
            animate={{ opacity: 1, y: 0 }} 
            exit={{ opacity: 0, y: 50 }}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--color-bg)', zIndex: 100, padding: '20px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}
          >
            <h2 style={{ textAlign: 'center', color: 'var(--color-primary)', marginBottom: '16px' }}>Tu Personaje</h2>
            
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <img src={getAvatarUrl(tempAvatar)} alt="Preview" style={{ width: '150px', height: '150px', borderRadius: '24px', backgroundColor: `#${tempAvatar?.backgroundColor}`, border: '4px solid white', boxShadow: '0 8px 16px rgba(0,0,0,0.1)', marginBottom: '16px' }} />
              <br/>
              <button onClick={handleRandomizeAvatar} style={{ background: 'var(--color-surface)', border: 'none', padding: '8px 16px', borderRadius: '100px', fontWeight: 'bold', cursor: 'pointer', boxShadow: 'var(--shadow-sm)' }}>
                🎲 Aleatorio
              </button>
            </div>

            <div style={{ flex: 1, background: 'var(--color-surface)', padding: '12px', borderRadius: '24px', marginBottom: '24px' }}>
              <ArrowSelector label="Color de piel" options={AVATAR_OPTIONS.skinColor} value={tempAvatar?.backgroundColor} onChange={v => setTempAvatar({...tempAvatar, backgroundColor: v})} />
              <ArrowSelector label="Ojos" options={AVATAR_OPTIONS.eyes} value={tempAvatar?.eyes} onChange={v => setTempAvatar({...tempAvatar, eyes: v})} />
              <ArrowSelector label="Boca" options={AVATAR_OPTIONS.mouth} value={tempAvatar?.mouth} onChange={v => setTempAvatar({...tempAvatar, mouth: v})} />
              <ArrowSelector label="Cejas" options={AVATAR_OPTIONS.eyebrows} value={tempAvatar?.eyebrows} onChange={v => setTempAvatar({...tempAvatar, eyebrows: v})} />
              <ArrowSelector label="Gafas" options={AVATAR_OPTIONS.glasses} value={tempAvatar?.glasses} onChange={v => setTempAvatar({...tempAvatar, glasses: v})} />
            </div>

            <button className="btn-party btn-green" onClick={saveAvatar} disabled={loading} style={{ padding: '16px', fontSize: '1.2rem', marginBottom: '12px' }}>
              {loading ? 'Guardando...' : 'Guardar Personaje'}
            </button>
            <button className="btn-party" onClick={() => setIsEditingAvatar(false)} style={{ background: '#ccc', color: 'black' }}>
              Cancelar
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Perfil del Usuario Premium */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', padding: '16px', background: 'var(--color-surface)' }}>
        <div style={{ position: 'relative', cursor: 'pointer', transition: 'transform 0.2s' }} onClick={openAvatarEditor} onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'} onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}>
          <img src={getAvatarUrl(player.avatarConfig)} alt="Avatar" style={{ width: '80px', height: '80px', borderRadius: '16px', backgroundColor: `#${player.avatarConfig?.backgroundColor || 'b6e3f4'}`, border: '3px solid white', boxShadow: '0 4px 10px rgba(0,0,0,0.1)', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', bottom: '-8px', left: '50%', transform: 'translateX(-50%)', background: 'var(--color-primary)', color: 'white', fontSize: '0.7rem', padding: '2px 8px', borderRadius: '100px', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
            Editar
          </div>
        </div>
        
        <div style={{ flex: 1, marginLeft: '8px' }}>
          <h2 style={{ fontSize: '1.5rem', color: 'var(--color-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            {player.name}
            <button onClick={() => { setNameInput(player.name); setIsEditingName(true); }} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', padding: 0 }}>✏️</button>
          </h2>
          <div style={{ color: '#888', fontSize: '0.9rem', marginTop: '4px', fontWeight: 'bold' }}>Jugador Legendario</div>
        </div>

        <div style={{ background: 'var(--color-bg)', padding: '12px', borderRadius: '16px', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)', textAlign: 'center', minWidth: '80px' }}>
          <div style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'bold' }}>PUNTOS</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#FFD700', textShadow: '0 2px 4px rgba(255,215,0,0.3)' }}>⭐ {player.globalScore || 0}</div>
        </div>
      </div>

      {/* JUGAR */}
      <div style={{ marginBottom: '24px' }}>
        {!showJoinForm ? (
          <button 
            className="btn-party" 
            onClick={() => setShowJoinForm(true)} 
            style={{ width: '100%', padding: '24px', fontSize: '1.8rem', fontWeight: 900, background: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '24px', boxShadow: '0 10px 20px rgba(0, 0, 0, 0.2)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '2px', transition: 'transform 0.2s' }}
          >
            🎮 ¡Jugar!
          </button>
        ) : (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="card">
            <h3 style={{ marginBottom: '16px', color: 'var(--color-text)' }}>Unirse a Sala</h3>
            {error && <p style={{ color: 'var(--color-accent-red)', fontWeight: 'bold', marginBottom: '8px' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <input 
                type="number" 
                placeholder="PIN" 
                className="input-party"
                style={{ flex: 1, letterSpacing: '4px', textAlign: 'center', fontSize: '1.2rem' }}
                value={pinInput}
                onChange={e => setPinInput(e.target.value)}
                maxLength={4}
              />
              <button className="btn-party btn-green" onClick={handleJoin} disabled={loading} style={{ flex: 1 }}>
                {loading ? '...' : 'Entrar'}
              </button>
            </div>
            <div style={{ textAlign: 'center', color: '#999', marginBottom: '16px', fontWeight: 'bold' }}>— O —</div>
            <button className="btn-party btn-blue" onClick={handleCreate} disabled={loading} style={{ width: '100%', padding: '16px' }}>
              🌟 Crear Nueva Sala
            </button>
            <button onClick={() => setShowJoinForm(false)} style={{ width: '100%', marginTop: '16px', background: 'none', border: 'none', color: '#888', fontWeight: 'bold', cursor: 'pointer' }}>
              Cancelar
            </button>
          </motion.div>
        )}
      </div>

      {/* Otras utilidades del Hub Global */}
      <h3 style={{ marginLeft: '8px', marginBottom: '12px', color: '#666', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>Utilidades y Tienda</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
        <div style={{ background: 'var(--color-surface)', padding: '20px 12px', borderRadius: '16px', boxShadow: 'var(--shadow-sm)', textAlign: 'center', cursor: 'pointer', border: '2px solid transparent', transition: '0.2s', ':active': { transform: 'scale(0.95)' } }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>📝</div>
          <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--color-primary)' }}>Añadir palabras</div>
        </div>
        <div style={{ background: 'var(--color-surface)', padding: '20px 12px', borderRadius: '16px', boxShadow: 'var(--shadow-sm)', textAlign: 'center', cursor: 'pointer' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>📸</div>
          <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--color-primary)' }}>Álbum de Fotos</div>
        </div>
        <div style={{ background: 'var(--color-accent-red)', color: 'white', padding: '20px 12px', borderRadius: '16px', boxShadow: 'var(--shadow-sm)', textAlign: 'center', cursor: 'pointer', gridColumn: '1 / -1' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🛍️</div>
          <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>Tienda de Ruiditos</div>
          <div style={{ fontSize: '0.8rem', opacity: 0.9, marginTop: '4px' }}>Gasta tus ⭐ aquí</div>
        </div>
      </div>

      {/* Retos Diarios (Movido al final) */}
      <div style={{ paddingBottom: '40px' }}>
        <h3 style={{ marginLeft: '8px', marginBottom: '12px', color: '#666', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 'bold' }}>Retos Diarios (Demo)</h3>
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--color-accent-green)', color: 'white', padding: '16px' }}>
          <div style={{ fontSize: '2.5rem' }}>🎯</div>
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: 0, fontSize: '1.1rem' }}>Sobrevive al Lobo</h4>
            <div style={{ background: 'rgba(255,255,255,0.3)', height: '8px', borderRadius: '4px', marginTop: '8px', overflow: 'hidden' }}>
              <div style={{ width: '0%', background: 'white', height: '100%' }}></div>
            </div>
            <p style={{ margin: 0, marginTop: '4px', fontSize: '0.8rem', opacity: 0.9 }}>0 / 1 completado</p>
          </div>
          <div style={{ fontWeight: 'bold', fontSize: '1.2rem', background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '12px' }}>+50⭐</div>
        </div>
      </div>

    </div>
  );
}
