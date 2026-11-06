import { WORLD_SETTING_IDS, type WorldSettingId } from '../../domain/settings';
import type { MessageKey } from '../i18n';
import { DEFAULT_WORLD, WORLDS, type WorldId } from './worlds';

const LABEL_KEYS = {
  'neon-tunnel': 'world.neonTunnel',
  road: 'world.road',
  scenes: 'world.scenes',
} satisfies Record<WorldSettingId, MessageKey>;

/** The worlds offered in the UI, in display order, with their label keys. */
export const WORLD_CHOICES: readonly { value: WorldSettingId; labelKey: MessageKey }[] =
  WORLD_SETTING_IDS.map((value) => ({
    value,
    labelKey: LABEL_KEYS[value],
  }));

/** The registered world for a stored id; anything the registry does not know gets the default. */
export function resolveWorld(id: string): WorldId {
  return Object.hasOwn(WORLDS, id) ? (id as WorldId) : DEFAULT_WORLD;
}
