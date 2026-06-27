import Anthropic from '@anthropic-ai/sdk'
import { LEAGUE_NAME } from '@/lib/config'

export interface CommentaryContext {
  picker: string // player display name
  driver: string // driver family name
  team?: string | null // constructor name
  grid?: number | null // qualifying position for this race, if known
  round: number
  overall: number // overall pick number in the draft
  pickInRound: number // 1..N within the round
  playerCount: number
  raceName: string
  players?: string[] // all player display names in this pool (for context)
}

// Built per-call so a copied instance roasts ITS group, not the original names.
function systemPrompt(players: string[] | undefined): string {
  const roster =
    players && players.length
      ? `${players.length} friends (${players.join(', ')})`
      : 'a group of friends'
  return `You are the ${LEAGUE_NAME} draft commentator: a savage, very funny Formula 1 fantasy-draft pundit in the style of a snarky TV analyst. ${roster} draft 5 drivers each per race; lowest combined finishing position wins (golf scoring), so picking strong, high-finishing drivers is good and picking backmarkers is mockable.

When given a pick, fire back ONE short line of trash talk roasting (or, rarely, grudgingly praising) it. Be witty, specific, and a little mean — riff on the driver's form, the team, the qualifying spot, the draft position, whatever's funny. Keep it PG-13.

Rules:
- Output ONLY the one-liner. No preamble, no quotation marks, no explanation, no emoji spam (one emoji max).
- Max ~180 characters. Punchy beats wordy.`
}

/**
 * Generate a one-line sarcastic commentary for a draft pick via Claude.
 * Returns null if no API key is configured or the call fails — callers treat
 * commentary as best-effort and fall back gracefully.
 */
export async function generateCommentary(ctx: CommentaryContext): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  try {
    const client = new Anthropic()
    const bits = [
      `${ctx.picker} just drafted ${ctx.driver}`,
      ctx.team ? `(${ctx.team})` : '',
      ctx.grid ? `who qualified P${ctx.grid}` : '',
      `— pick ${ctx.pickInRound} of ${ctx.playerCount} in round ${ctx.round} for the ${ctx.raceName}.`,
    ].filter(Boolean)
    const resp = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 200,
      output_config: { effort: 'low' },
      system: systemPrompt(ctx.players),
      messages: [{ role: 'user', content: `${bits.join(' ')} Roast this pick.` }],
    })
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      .replace(/^["']|["']$/g, '')
    return text || null
  } catch {
    return null
  }
}
