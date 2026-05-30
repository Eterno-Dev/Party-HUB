import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD1oj7BGvhLRyR8Wj0jPtSGVfVsoLYR398",
  authDomain: "party-hub-dc005.firebaseapp.com",
  projectId: "party-hub-dc005",
  storageBucket: "party-hub-dc005.firebasestorage.app",
  messagingSenderId: "136562954972",
  appId: "1:136562954972:web:9b4270464336c5337c9a19"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore (Database)
export const db = getFirestore(app);
