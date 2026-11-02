# Playback session save hardening

- Save the latest direct video position before closing the player.
- Force a final progress save when the app is backgrounded or page-hidden.
- Flush queued playback progress after each lifecycle save.
- Preserve provider iframe behaviour and existing resume semantics.
