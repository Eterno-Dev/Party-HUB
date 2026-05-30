import { createContext, useContext, useState, useEffect } from 'react';
import { getLocalUser, fetchUserFromDb } from '../lib/userService';

const GameContext = createContext();

export function GameProvider({ children }) {
  const [roomPin, setRoomPin] = useState(() => localStorage.getItem('roomPin') || null);
  const [player, setPlayer] = useState(() => getLocalUser() || null);
  const [roomData, setRoomData] = useState(null);
  const [loadingGlobal, setLoadingGlobal] = useState(true);

  useEffect(() => {
    if (roomPin) {
      localStorage.setItem('roomPin', roomPin);
    } else {
      localStorage.removeItem('roomPin');
    }
  }, [roomPin]);

  useEffect(() => {
    const initUser = async () => {
      const local = getLocalUser();
      if (local) {
        setPlayer(local);
        try {
          const dbUser = await fetchUserFromDb(local.id);
          if (dbUser) setPlayer(dbUser);
        } catch (e) {
          console.error("No se pudo sincronizar usuario global", e);
        }
      }
      setLoadingGlobal(false);
    };
    initUser();
  }, []);

  return (
    <GameContext.Provider value={{ 
      roomPin, setRoomPin, 
      player, setPlayer,
      roomData, setRoomData,
      loadingGlobal
    }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  return useContext(GameContext);
}
