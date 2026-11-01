export interface SectionTop {
  id: string;
  /** Distance of the section's top edge from the viewport top, in px. */
  top: number;
}

/**
 * The section the reader is in: the last one whose top has passed the activation line (30 % down
 * the viewport). At the very bottom the last section wins, since a short last card can never
 * scroll up to the line.
 */
export function pickActiveSection(
  sections: readonly SectionTop[],
  viewportHeight: number,
  atBottom: boolean,
): string | undefined {
  const first = sections[0];
  if (!first) return undefined;
  if (atBottom) return sections[sections.length - 1]?.id;
  const line = viewportHeight * 0.3;
  let active = first.id;
  for (const s of sections) if (s.top <= line) active = s.id;
  return active;
}
