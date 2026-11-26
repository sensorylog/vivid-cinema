# VIVID ANIME PREMIUM — Phase 6 QA

Use a real signed-in browser session. The library page is private and must remain inaccessible to users without an active, server-verified Premium membership.

## Membership and privacy
- [ ] Signed-out visitor is sent to Vivid sign-in with a return path to My Anime.
- [ ] Signed-in user with no active Premium membership sees the membership gate and no library data.
- [ ] Unverified email receives the email-verification gate.
- [ ] Active member can open My Anime.
- [ ] Expired/cancelled membership loses access after the server entitlement check.
- [ ] User A cannot read or mutate User B's library, episode progress or anime preferences.
- [ ] Switching accounts on the same browser does not leak local playback preferences between accounts.

## Library collections
- [ ] Add a title to Watch Later from its Premium title page; it appears in My Anime after navigation/reload.
- [ ] Add/remove a title from Favourites; the collection updates correctly.
- [ ] Mark a TV anime as Completed and undo that action.
- [ ] Complete an anime film in the player; it is marked completed.
- [ ] Opening a title page without starting playback does not create watch history.
- [ ] Starting actual playback creates one anime-tagged history record and updates its last-watched time.
- [ ] Normal movie/TV library entries remain visible in the general Vivid library and are not incorrectly classified as anime.

## Episode progress and Continue Watching
- [ ] Start a TV episode, leave playback, and confirm the exact season/episode and progress appear in Continue Watching.
- [ ] Resume the same episode and confirm playback starts near the saved position.
- [ ] Season 0 specials retain season 0 in the progress key and route.
- [ ] Single-entry anime catalogues keep their global episode numbering.
- [ ] Season-specific anime entries keep their local episode numbering.
- [ ] Episode completion appears in Completed Episodes without automatically marking the entire TV series Completed.
- [ ] Autoplay-next advances only when enabled and another episode exists.
- [ ] Preferred provider is tried first only when available; otherwise the normal healthy-provider fallback is used.

## Personal preferences
- [ ] Sub/Dub selection persists after reload and syncs to the signed-in Vivid account.
- [ ] Autoplay-next preference persists and syncs across devices.
- [ ] Preferred provider persists and syncs across devices.
- [ ] Preferred subtitle language persists; provider-specific application is only expected where the selected provider supports it.
- [ ] Offline preference changes reconcile correctly after reconnecting.

## Offline and regression
- [ ] My Anime page, CSS and scripts are present in the service-worker shell.
- [ ] Returning online refreshes cloud library/progress data without duplicating entries.
- [ ] Existing non-anime favorites, Watch Later, history and progress continue to work.
- [ ] Existing free anime page remains unchanged.
- [ ] The provider QA matrix is completed separately; iframe load alone does not count as playback success.

## Release guard
- [ ] Keep the Android APK and Windows package jobs skipped until every phase and all manual QA are complete.
- [ ] Do not publish or release packages during this phase.
