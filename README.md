# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
(next) a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

Save a private HTML copy of the digest with `pnpm preview:save /tmp/rig-review.html`.
See [preview instructions](docs/preview.md) for marked and clean exports.
