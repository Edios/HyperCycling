import { createHashRouter, Outlet, RouterProvider, type RouteObject } from 'react-router-dom';
import { EditorScreen } from './editor/EditorScreen';
import { DevHome } from './screens/DevHome';
import { SettingsEffects } from './settings/SettingsEffects';
import { SettingsScreen } from './settings/SettingsScreen';
import { PlayersScreen } from './players/PlayersScreen';
import { ResumePrompt } from './setup/ResumePrompt';
import { SetupScreen } from './setup/SetupScreen';
import { SummaryScreen } from './summary/SummaryScreen';
import { PlanDetail } from './plans/PlanDetail';
import { PlanGallery } from './plans/PlanGallery';
import { PlanWizard } from './plans/PlanWizard';
import { FreestyleTab } from './select/FreestyleTab';
import { PlanTab } from './select/PlanTab';
import { SelectShell } from './select/SelectShell';
import { DevHyperride } from './screens/DevHyperride';
import { TrainingScreen } from './training/TrainingScreen';

/** The demo list is for development and e2e only: dev builds, or any build opened with ?dev. */
const DEV_ROUTE =
  import.meta.env.DEV ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev'));

function Root() {
  return (
    <>
      <SettingsEffects />
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
        { path: '/dev/hyperride', element: <DevHyperride /> },
        { path: '/train', element: <TrainingScreen /> },
        { path: '/summary', element: <SummaryScreen /> },
        { path: '/players', element: <PlayersScreen /> },
        {
          path: '/plans',
          element: (
            <SelectShell>
              <PlanGallery />
            </SelectShell>
          ),
        },
        { path: '/plans/wizard', element: <PlanWizard /> },
        {
          path: '/plans/:planId',
          element: (
            <SelectShell>
              <PlanDetail />
            </SelectShell>
          ),
        },
        { path: '/editor/:workoutId', element: <EditorScreen /> },
        { path: '/settings', element: <SettingsScreen /> },
        // Developer shortcut (see DEV_ROUTE): rides any built-in workout with demo players.
        ...(DEV_ROUTE ? [{ path: '/dev', element: <DevHome /> }] : []),
        { path: '*', element: planPage },
      ],
    },
  ];
}

// A data router (not <HashRouter>) is required for useBlocker, which guards unsaved editor changes.
// Created once, on first render: not at import time, because the Spotify login redirect lands
// without a hash and main.tsx restores the route (history.replaceState) before the first render.
// A singleton, since a router created during render would be duplicated by StrictMode.
let router: ReturnType<typeof createHashRouter> | undefined;

export function App() {
  router ??= createHashRouter(routes());
  return <RouterProvider router={router} />;
}
