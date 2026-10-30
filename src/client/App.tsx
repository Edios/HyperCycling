import { HashRouter, Route, Routes } from 'react-router-dom';
import { DevHome } from './screens/DevHome';
import { PlaceholderPage } from './screens/PlaceholderPage';
import { ResumePrompt } from './setup/ResumePrompt';
import { SetupScreen } from './setup/SetupScreen';
import { SummaryPlaceholder } from './screens/SummaryPlaceholder';
import { FreestyleTab } from './select/FreestyleTab';
import { PlanTab } from './select/PlanTab';
import { SelectShell } from './select/SelectShell';
import { TrainingScreen } from './training/TrainingScreen';

/** The demo list is for development and e2e only: dev builds, or any build opened with ?dev. */
const DEV_ROUTE =
  import.meta.env.DEV ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev'));

export function App() {
  return (
    <HashRouter>
      <ResumePrompt />
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
        <Route path="/setup/:workoutId" element={<SetupScreen />} />
        <Route path="/train" element={<TrainingScreen />} />
        <Route path="/summary" element={<SummaryPlaceholder />} />
        <Route path="/plans" element={<PlaceholderPage titleKey="placeholder.plans" />} />
        <Route path="/players" element={<PlaceholderPage titleKey="nav.players" />} />
        <Route path="/settings" element={<PlaceholderPage titleKey="nav.settings" />} />
        {/* Developer shortcut (see DEV_ROUTE): rides any built-in workout with demo players. */}
        {DEV_ROUTE && <Route path="/dev" element={<DevHome />} />}
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
