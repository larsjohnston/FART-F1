/** Team accent colors keyed by Jolpica constructorId, for the 2026 grid (11 teams).
 *  Used as the source of truth for driver-card accents and the Teams screen.
 *  OpenF1 normally supplies live livery colors, but it locks down during race
 *  weekends (paid-only), so these guarantee the board always looks right. */
export const TEAM_COLORS: Record<string, string> = {
  red_bull: '#3671C6',
  ferrari: '#E8002D',
  mercedes: '#27F4D2',
  mclaren: '#FF8000',
  aston_martin: '#229971',
  alpine: '#2293FF',
  williams: '#1868DB',
  rb: '#6692FF',
  haas: '#B6BABD',
  audi: '#BB0A30',
  cadillac: '#C5A45B',
}
