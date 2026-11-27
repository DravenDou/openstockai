# Chat blocks

Adaptations of the Message, Conversation and Tool components from
[Vercel AI Elements](https://elements.ai-sdk.dev/), under the bundled MIT license.
Source: official registry, accessed on October 12, 2026:

- https://elements.ai-sdk.dev/api/registry/message.json
- https://elements.ai-sdk.dev/api/registry/conversation.json
- https://elements.ai-sdk.dev/api/registry/tool.json

Only the blocks used by OpenStock AI were kept, with imports adjusted to `shared`,
the existing style and English labels. MessageResponse uses Streamdown without code,
math or diagram plugins. Tool inputs/outputs render JSON in a native `pre`; the
highlighter was not included. Conversation keeps autoscroll with
`use-stick-to-bottom`, respecting the user scrolling up.

Eve still manages the session, events, tools and approvals. These components are
presentation only; they do not introduce `useChat` or any parallel transport/model.
The assistant feature adapts Eve parts, identifies domain failures and shows
durable turn errors, even when Eve returns `ready` with an empty error.

Pinned dependencies: Streamdown 2.7.0 and use-stick-to-bottom 1.1.6. Compatibility
checked against the installed React/Next, official guides and peers. Context7 was
not available. Before installing: OSV for both versions and `pnpm audit --prod`
on the resolved lock, with no known vulnerabilities in those sources.
