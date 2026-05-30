import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { GameProvider } from './contexts/GameContext';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import BombGame from './pages/BombGame';
import ChameleonGame from './pages/ChameleonGame';
import NeverGame from './pages/NeverGame';
import WolfGame from './pages/WolfGame';

function App() {
  return (
    <GameProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/bomb" element={<BombGame />} />
          <Route path="/chameleon" element={<ChameleonGame />} />
          <Route path="/never" element={<NeverGame />} />
          <Route path="/wolf" element={<WolfGame />} />
        </Routes>
      </Router>
    </GameProvider>
  );
}

export default App;
