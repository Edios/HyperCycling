import { useState } from 'react';
import { createHashRouter, Outlet, RouterProvider, type RouteObject } from 'react-router-dom';
import { EditorScreen } from './editor/EditorScreen';
import { DevHome } from './screens/DevHome';
import { PlaceholderPage } from './screens/PlaceholderPage';
import { PlayersScreen } from './players/PlayersScreen';
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

function Root() {
  return (
    <>
      <ResumePrompt />
      <Outlet />
    </>
  );
}

const planPage = (
  <SelectShell>
    <PlanTab />
  </SelectShell>
);

function routes(): RouteObject[] {
  return [
    {
      element: <Root />,
      children: [
        { path: '/', element: planPage },
        {
          path: '/freestyle',
          element: (
            <SelectShell>
              <FreestyleTab />
            </SelectShell>
          ),
        },
        { path: '/setup/:workoutId', element: <SetupScreen /> },
        { path: '/train', element: <TrainingScreen /> },
        { path: '/summary', element: <SummaryPlaceholder /> },
        { path: '/plans', element: <PlaceholderPage titleKey="placeholder.plans" /> },
        { path: '/players', element: <PlayersScreen /> },
        { path: '/editor/:workoutId', element: <EditorScreen /> },
        { path: '/settings', element: <PlaceholderPage titleKey="nav.settings" /> },
        // Developer shortcut (see DEV_ROUTE): rides any built-in workout with demo players.
        ...(DEV_ROUTE ? [{ path: '/dev', element: <DevHome /> }] : []),
        { path: '*', element: planPage },
      ],
    },
  ];
}

// A data router (not <HashRouter>) is required for useBlocker, which guards unsaved editor changes.
export function App() {
  const [router] = useState(() => createHashRouter(routes()));
  return <RouterProvider router={router} />;
}
