import { HashRouter, Route, Routes } from 'react-router-dom';
import { DevHome } from './screens/DevHome';
import { SummaryPlaceholder } from './screens/SummaryPlaceholder';
import { TrainingScreen } from './training/TrainingScreen';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<DevHome />} />
        <Route path="/train" element={<TrainingScreen />} />
        <Route path="/summary" element={<SummaryPlaceholder />} />
        <Route path="*" element={<DevHome />} />
      </Routes>
    </HashRouter>
  );
}
