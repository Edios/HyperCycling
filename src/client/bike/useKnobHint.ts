import { bikeKindOf, knobHint, type KnobHint } from '../../domain/bike';
import { resolveResistanceMode } from '../../domain/settings';
import { useSettings } from '../data/useSettings';

/** Podpowiedź pokrętła dla poziomu wysiłku wg kalibracji z ustawień; undefined bez kalibracji. */
export function useKnobHint(): (effort: number) => KnobHint | undefined {
  const { settings } = useSettings();
  const kind = bikeKindOf(resolveResistanceMode(settings), settings.equipment);
  return (effort) => knobHint(kind, settings.knobSteps, effort);
}
