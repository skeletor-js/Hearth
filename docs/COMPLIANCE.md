# Compliance — authentication rules

Hearth drives Claude Code and Codex. To stay inside Anthropic's terms, it must
behave like an **editor that drives a local agent the user authenticated**, not a
product that routes requests through someone's subscription.

Anthropic's [Claude Code legal page](https://code.claude.com/docs/en/legal-and-compliance)
is explicit: OAuth (subscription) auth is for ordinary use of Claude Code and
native Anthropic apps; third-party developers may **not** offer Claude.ai login
or route requests through Free/Pro/Max credentials on behalf of their users.
Products built on the Agent SDK "should use API key authentication."

## Hard rules for this codebase

1. **Never render the Claude OAuth flow.** The user runs `claude login` in their
   own environment. We spawn the agent they already authenticated.
2. **Never store, broker, or proxy a subscription token.** The ACP client spawns
   a local adapter subprocess and inherits the user's existing auth. No token
   touches our storage, our servers, or our logs.
3. **Never host the agent for the user.** Inference runs locally as their
   process on their credential. No server-side fan-out on their subscription.
4. **Offer BYO-API-key as a first-class path.** It is the unambiguously-allowed
   option and the right default for anything commercial.

## Things to keep watching

- **June 15, 2026:** Agent SDK / `claude -p` usage on subscription plans draws
  from a separate metered Agent SDK credit pool. The Claude ACP adapter runs
  through the Agent SDK, so subscription-powered usage is metered there — not the
  full interactive allowance. Surface this to users; don't promise "unlimited."
- **"Ordinary individual usage"** is the clause Anthropic can pull against a
  commercial wrapper even when auth is clean. If Hearth becomes a commercial
  product, get a direct read from Anthropic rather than relying on this doc.
