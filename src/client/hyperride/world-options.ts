import { HYPERRIDE_WORLD_IDS, type HyperrideWorldId } from '../../domain/settings';
import type { MessageKey } from '../i18n';
import { DEFAULT_WORLD, WORLDS, type WorldId } from './worlds';

/** The worlds offered in the UI, in display order, with their label keys. */
export const WORLD_CHOICES: readonly { value: HyperrideWorldId; labelKey: MessageKey }[] =
  HYPERRIDE_WORLD_IDS.map((value) => ({
    value,
    labelKey: value === 'road' ? 'world.road' : 'world.neonTunnel',
  }));

/** The registered world for a stored id; anything the registry does not know gets the default. */
export function resolveWorld(id: string): WorldId {
  return Object.hasOwn(WORLDS, id) ? (id as WorldId) : DEFAULT_WORLD;
}
