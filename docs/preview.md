# Save a review preview

Start rig from this checkout with `pnpm start`. It listens on `127.0.0.1`, using
`PORT` or port 8787. The server loads the existing `.env`; keep that file private.

In another terminal, save the running digest with its lane banner:

```sh
PREVIEW_MODE=marked pnpm preview:save /tmp/rig-review.html
```

The output directory must already exist and must be outside every Git checkout.
Set the same `PORT` for both commands if using a different port. The command
fetches `/digest/2026-10-28`, rejects unsuccessful responses, checks the HTML's
inline stylesheet and passive markup, and requires a populated lane marker.
It saves the exact response atomically with file permissions `0600`, without
printing the HTML or marker. A failed check leaves any existing output untouched.

The command only creates a private local file. Public hosting, sending the link
to the reviewer, and replacing the hosted preview are separate steps. Do not
commit preview files or attach them to issues or chats (ADR 0003).

For the later approved cleanup step, stop the marked server and restart it with
an explicitly empty marker, then export again:

```sh
LANE_MARKER= pnpm start
# In another terminal:
PREVIEW_MODE=clean pnpm preview:save /tmp/rig-review.html
```

Clean mode verifies that the banner says `no marker set`. The same public URL
must eventually be overwritten with that clean file; this command does not
upload it or complete the review/cleanup issues.
