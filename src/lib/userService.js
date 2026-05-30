import { db } from './firebase';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';

// Clave para guardar en el navegador
const STORAGE_KEY = 'partyHubUser';

export const getLocalUser = () => {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : null;
};

export const registerUser = async (name) => {
  const existingLocal = getLocalUser();
  const userId = existingLocal?.id || crypto.randomUUID();
  
  const defaultAvatar = {
    seed: userId,
    eyes: 'default',
    mouth: 'default',
    eyebrows: 'default',
    clothing: 'hoodie',
    accessories: 'none',
    backgroundColor: 'b6e3f4'
  };

  const userData = {
    id: userId,
    name,
    globalScore: existingLocal?.globalScore || 0,
    avatarConfig: existingLocal?.avatarConfig || defaultAvatar,
    createdAt: new Date().toISOString()
  };

  // Guardar en base de datos global
  await setDoc(doc(db, 'users', userId), userData, { merge: true });
  
  // Guardar en memoria del navegador
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
  
  return userData;
};

export const updateUserAvatarConfig = async (userId, newConfig) => {
  const userRef = doc(db, 'users', userId);
  await updateDoc(userRef, { avatarConfig: newConfig });
  
  const local = getLocalUser();
  if (local) {
    local.avatarConfig = newConfig;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
  }
};

export const updateUserName = async (userId, newName) => {
  const userRef = doc(db, 'users', userId);
  await updateDoc(userRef, { name: newName });
  
  const local = getLocalUser();
  if (local) {
    local.name = newName;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
  }
};

export const fetchUserFromDb = async (userId) => {
  const snap = await getDoc(doc(db, 'users', userId));
  if (snap.exists()) {
    const data = snap.data();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
  }
  return null;
};
