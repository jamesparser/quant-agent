/**
 * Guards against a chat model that narrates NEAR actions instead of calling
 * the tools: detection of announced or claimed actions, hard prompt rules, and
 * removal of explorer links that did not come from a tool result.
 *
 * @module lib/near/guard
 */

/** Text that claims a NEAR action is running, used to catch a model that narrates instead of calling the tool. */
export const NEAR_PROMISE_RE =
  /\((calling|unwrapping|wrapping|swapping|sending|staking|executing|transferring|bridging|retrying)\b[^)]*\)|\(calling near_|\bcalling near_(swap|stake|lend|transfer|crosschain)\b|approving and executing|executing (it |this |the \w+ )?now|runs on its own|submitting (it |the \w+ )?now|sending (it )?now|placing (it|the order) now|\blet me (do that|do it|try again|retry|call|execute|run|swap|send|place)\b|i('ll| will) (do that|call|execute|run) (it |that |the \w+ )?now/i
export const NEAR_ACTION_TOOL_RE = /^near_(swap|stake|lend|transfer|crosschain)$/
/** Text that claims a NEAR action already finished. */
export const NEAR_DONE_RE =
  /nearblocks\.io\/txns\/|\b(swap|transfer|send|stake|staking|supply|deposit|withdrawal|bridge|cross-chain)\b[^.\n]{0,40}\b(completed|complete|done|executed|succeeded|successful)\b|✅/i
/** The user asked for (or agreed to) an on-chain action in this message. */
export const NEAR_INTENT_RE =
  /\b(swap|send|transfer|stake|unstake|lend|supply|withdraw|bridge|move|convert|buy|sell|yes|yep|proceed|approve|do it|go ahead|confirm)\b/i
/** Hard rules for NEAR actions, added to the system prompt. */
export const NEAR_RULES = `NEAR action rules (these override anything else):
- To swap, stake, lend, withdraw, send or move assets on NEAR, make a real function call to the near_* action tool. Writing about it does nothing.
- Never ask "Shall I proceed?" in text. The tool itself shows an approval card when one is needed, or runs on its own in YOLO mode within limits.
- Never state an amount out, price, rate or result you did not get from a tool result in this conversation. NEAR trades for several USD; never invent quotes.
- Never write a transaction hash or explorer link that did not come from a tool result. Only report success when the tool returned success: true.`

const TX_LINK_RE =
  /\[[^\]\n]*\]\(https?:\/\/(?:testnet\.)?nearblocks\.io\/txns\/(\w+)\)|https?:\/\/(?:testnet\.)?nearblocks\.io\/txns\/(\w+)/g

/** Remove nearblocks transaction links whose hash is not in the tool output. */
export function stripUnverifiedTxLinks(content: string, toolOutput: string): { content: string; removed: number } {
  let removed = 0
  const out = content.replace(TX_LINK_RE, (m, h1?: string, h2?: string) => {
    const hash = h1 || h2 || ''
    if (hash && toolOutput.includes(hash)) return m
    removed++
    return '(unverified link removed)'
  })
  return { content: out, removed }
}

/** Message sent back to the model when it narrated an action instead of calling the tool. */
export const NEAR_NUDGE =
  'You wrote that a NEAR action is running or done, but you made no real tool call in this reply, so nothing happened on-chain. If the user asked for this action now, make the actual function call to the matching near_* action tool (near_swap, near_stake, near_lend, near_transfer or near_crosschain) with their parameters, without writing text first. If a tool result earlier in the conversation already shows this exact action succeeded, do not repeat it: answer in plain text and only cite that result.'
