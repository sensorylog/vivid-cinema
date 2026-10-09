# Vivid Cinema intentionality audit — first pass

## Scope and safety rule

This pass is deliberately conservative. It prioritizes changes with a clear user benefit and a small regression surface. It does not replace browser, device, accessibility, payment-provider, or production testing. Do not merge or deploy this branch until the checks below have been completed.

## Confirmed source-level observations

### 1. CSS cascade complexity — investigate, do not mass-refactor yet

A source scan of the current shared styles found approximately:
- `styles/vivid-audit-fixes.css`: 56.7 KB and 530 `!important` declarations.
- `styles/vivid-liquid-glass.css`: 67.4 KB and 679 `!important` declarations.
- `styles/vivid-desktop.css`: 14.6 KB and 201 `!important` declarations.
- `styles/vivid-home.css`: 31.9 KB and 315 `!important` declarations.

These counts do not prove individual bugs, but they are a strong maintainability signal. The same selector appears more than once in some files, which can be intentional for responsive or state overrides. Do not delete or consolidate rules by count alone: the later styles can be protecting layout, navigation, theme, or accessibility fixes.

**Safe next step:** map high-impact duplicate selectors across landing, home, discovery, title, watch, library and auth; capture desktop/mobile baselines; then remove only demonstrably redundant rules in a separate, visually testable PR.

### 2. Shared versus page-specific styling

The pages load different combinations of shared and page-specific styles. This can be reasonable, but the ownership rules should be explicit:
- foundation: design tokens only;
- system: reusable primitives and global typography;
- shell: navigation, shared layout and common interaction surfaces;
- page styles: unique page composition;
- compatibility/audit overrides: temporary, documented exceptions with a removal condition.

Do not change the global stylesheet order until cross-page visual regression checks are available.

### 3. Performance and runtime

Source inspection alone cannot confirm Core Web Vitals, layout shift, network waterfall, real-device rendering, keyboard usability, authentication, or playback reliability. These remain test tasks, not claimed pass results.

## Support Vivid page changes in this branch

- Reframed the page around a clear, voluntary invitation rather than pressure.
- Made Ghana/local and international payment routes distinct and understandable.
- Preserved the existing Paystack form IDs, amount preset container, status region, public key handling, GHS currency, and Gumroad URL so the existing checkout script remains connected.
- Clarified that payment methods and currency availability are shown by the payment provider at checkout; the page does not promise unverified methods.
- Added responsive layout, visible keyboard focus, reduced-motion handling, and forced-colors support to the page styles.
- Added `donate.html` and `donation-success.html` to the app-shell precache and bumped the cache version so installed clients can receive the updated shell.

No payment processing logic or credentials were changed. This branch has not been deployed, and checkout has not been live-tested.

## Required verification before merge

1. Compare landing, home, search, discovery, title, watch, library, account/auth, donate and donation-success pages at narrow mobile, wide mobile/tablet and desktop widths.
2. Confirm the support form still renders suggested amounts and updates the amount field when a preset is selected.
3. Test Paystack checkout in a safe test environment where available; verify cancellation, provider-load failure and success navigation. Never treat the browser callback alone as server-side payment verification.
4. Open the Gumroad link and confirm the external product, price, currency, and checkout route are still correct.
5. Verify service-worker installation/update and that the donation pages are available online and via the intended offline fallback.
6. Run repository CI and existing Firestore/security tests.
7. Keyboard-test every support control; verify focus visibility, zoom/reflow and reduced-motion preferences.

## Deliberately not changed

- No mass CSS cleanup or selector reordering: current overrides may protect working layouts.
- No Firebase Functions deployment or Blaze changes.
- No change to Paystack/Gumroad payment integration logic.
- No claim that live payments, browser/device QA or production deployment have passed.
