import type { MessageKey } from '../i18n';

/** localStorage key of the editor tour; bump the suffix to show a rewritten tour to everyone again. */
export const EDITOR_TOUR_KEY = 'tour.editor.v1';

export interface EditorTourStep {
  id: 'timeline' | 'add' | 'effort' | 'time' | 'details' | 'music' | 'save';
  /** Selectors tried in order; the first visible one is outlined. */
  targets: string[];
  title: MessageKey;
  body: MessageKey;
}

const BLOCK = '[data-testid="editor-block"]';

/** Seven short steps, in the order a first workout is built. */
export const EDITOR_TOUR_STEPS: readonly EditorTourStep[] = [
  {
    id: 'timeline',
    targets: ['[data-tour="timeline"]'],
    title: 'tour.editor.steps.timeline.title',
    body: 'tour.editor.steps.timeline.body',
  },
  {
    id: 'add',
    targets: ['[data-tour="palette"]'],
    title: 'tour.editor.steps.add.title',
    body: 'tour.editor.steps.add.body',
  },
  {
    id: 'effort',
    targets: [BLOCK, '[data-tour="timeline"]'],
    title: 'tour.editor.steps.effort.title',
    body: 'tour.editor.steps.effort.body',
  },
  {
    id: 'time',
    targets: [BLOCK, '[data-tour="timeline"]'],
    title: 'tour.editor.steps.time.title',
    body: 'tour.editor.steps.time.body',
  },
  {
    id: 'details',
    targets: ['[data-tour="details"]'],
    title: 'tour.editor.steps.details.title',
    body: 'tour.editor.steps.details.body',
  },
  {
    id: 'music',
    targets: ['[data-tour="music"]'],
    title: 'tour.editor.steps.music.title',
    body: 'tour.editor.steps.music.body',
  },
  {
    id: 'save',
    targets: ['[data-tour="save"]'],
    title: 'tour.editor.steps.save.title',
    body: 'tour.editor.steps.save.body',
  },
];
