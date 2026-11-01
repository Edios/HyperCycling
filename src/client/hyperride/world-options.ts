import { HYPERRIDE_WORLD_IDS, type HyperrideWorldId } from '../../domain/settings';
import type { MessageKey } from '../i18n';
import { DEFAULT_WORLD, WORLDS, type WorldId } from './worlds';

const LABEL_KEYS = {
  'neon-tunnel': 'world.neonTunnel',
  road: 'world.road',
  scenes: 'world.scenes',
} satisfies Record<HyperrideWorldId, MessageKey>;

/** The worlds offered in the UI, in display order, with their label keys. */
export const WORLD_CHOICES: readonly { value: HyperrideWorldId; labelKey: MessageKey }[] =
  HYPERRIDE_WORLD_IDS.map((value) => ({
    value,
    labelKey: LABEL_KEYS[value],
  }));

/** The registered world for a stored id; anything the registry does not know gets the default. */
export function resolveWorld(id: string): WorldId {
  return Object.hasOwn(WORLDS, id) ? (id as WorldId) : DEFAULT_WORLD;
}
