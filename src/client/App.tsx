import { HashRouter, Route, Routes } from 'react-router-dom';
import { DevHome } from './screens/DevHome';
import { PlaceholderPage } from './screens/PlaceholderPage';
import { SetupPlaceholder } from './screens/SetupPlaceholder';
import { SummaryPlaceholder } from './screens/SummaryPlaceholder';
import { FreestyleTab } from './select/FreestyleTab';
import { PlanTab } from './select/PlanTab';
import { SelectShell } from './select/SelectShell';
import { TrainingScreen } from './training/TrainingScreen';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route
          path="/"
          element={
            <SelectShell>
              <PlanTab />
            </SelectShell>
          }
        />
        <Route
          path="/freestyle"
          element={
            <SelectShell>
              <FreestyleTab />
            </SelectShell>
          }
        />
        <Route path="/setup/:workoutId" element={<SetupPlaceholder />} />
        <Route path="/train" element={<TrainingScreen />} />
        <Route path="/summary" element={<SummaryPlaceholder />} />
        <Route path="/plans" element={<PlaceholderPage titleKey="placeholder.plans" />} />
        <Route path="/players" element={<PlaceholderPage titleKey="nav.players" />} />
        <Route path="/settings" element={<PlaceholderPage titleKey="nav.settings" />} />
        {/* Developer shortcut kept for e2e: rides any built-in workout with demo players. */}
        <Route path="/dev" element={<DevHome />} />
        <Route
          path="*"
          element={
            <SelectShell>
              <PlanTab />
            </SelectShell>
          }
        />
      </Routes>
    </HashRouter>
  );
}
