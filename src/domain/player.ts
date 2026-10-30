import { z } from 'zod';

export interface Player {
  id: string;
  name: string;
  ftp: number;
  isMe?: boolean;
}

export const playerSchema: z.ZodType<Player> = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(24),
  ftp: z.number().int().min(50).max(600),
  isMe: z.boolean().optional(),
}) as unknown as z.ZodType<Player>; // optional-field inference caveat (exactOptionalPropertyTypes)

/** Validates a list of players: every item valid and at most one `isMe`. */
export function validatePlayers(
  list: unknown,
): { ok: true; players: Player[] } | { ok: false; details: string } {
  const r = z.array(playerSchema).safeParse(list);
  if (!r.success) return { ok: false, details: formatIssue(r.error) };
  if (r.data.filter((p) => p.isMe).length > 1) {
    return { ok: false, details: 'at most one player can be marked isMe' };
  }
  return { ok: true, players: r.data };
}

function formatIssue(err: z.ZodError): string {
  const i = err.issues[0];
  return i ? `${i.path.join('.')}: ${i.message}` : 'invalid';
}
