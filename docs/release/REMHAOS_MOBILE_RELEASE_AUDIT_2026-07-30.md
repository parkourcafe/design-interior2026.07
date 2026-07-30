# Mobile Release Audit — RemHaOS

## Release identity

- App: RemHaOS
- Audit date/time zone: 30.07.2026, Asia/Makassar
- Target: Apple App Store, iPhone; RU localization
- Repository: dirty working tree with pre-existing parallel work; exact release commit not frozen
- Production URL: `https://www.remhaos.com`
- Production deployment: `dpl_6Z8dw7aP3R6XoboZHdpDuuUuy24e`
- Bundle ID: `space.arhidom.ios` (retained intentionally)
- Apple Team: configured locally; value omitted from this public report
- Version/build: 1.0 / 1
- Development archive binary SHA-256:
  `4cfadc32bb6b37cd9d2c7bdabcc01f98faf16b5ce3ab951475da0ba41c37c0ce`
- App Store IPA SHA-256:
  `494d696aada9f47a43b505ecc61b689592185c067eb0c52dd2982806e2f75873`
- App Store Connect app ID: `6794798655`
- App Store Connect status: version 1.0 (build 1) submitted;
  `Ожидание проверки` / Waiting for Review
- App Review submission ID: `fc6f033b-20cf-4ae8-84f2-805993f4a614`

## Verdict

**SUBMITTED — WAITING FOR REVIEW**

Production, signing, Archive, App Store IPA, metadata, screenshot, reviewer
account and submission gates are closed. App Store Connect confirmed submission
and reports version 1.0 as `Ожидание проверки`. Release is configured for manual
publication after approval. Residual QA/source-reconciliation risks below remain
post-submission follow-ups and must not be represented as completed.

## Channel status

| Channel/platform | Current status | Intended scope | Result | Evidence |
|---|---|---|---|---|
| iOS TestFlight | build 1 ready for testing; no testers/groups assigned | iPhone | READY | App Store Connect |
| iOS App Store submission | submitted; Waiting for Review | iPhone | SUBMITTED | App Review submission `fc6f033b…` |
| iPadOS App Store | not targeted | none | N/A | `TARGETED_DEVICE_FAMILY = 1` |
| Android stores | outside this rebrand audit | unchanged | NOT CHECKED | — |
| Production web/PWA | deployment READY | RU | GO | live HTTP checks |

## Findings

### P0 — stop ship

1. The uploaded binary was built from a dirty working tree that is not frozen
   in a release commit. The exact source must be committed before submission.
2. The build installs and launches on physical iPhone hardware, but login,
   Universal Links, files, core workflow, logout and account deletion have not
   yet been completed end-to-end on a physical iPhone.

### P1 — blocks intended scope

1. App is a remote Capacitor web wrapper; Guideline 4.2 minimum-functionality risk
   remains until app-like device UX and full utility are demonstrated to review.
2. App name, subtitle, primary category, version copy, support/marketing URLs,
   copyright, Privacy Policy URL, App Privacy answers, age rating, content
   rights, zero price, RU-only availability and build assignment are verified
   in App Store Connect. The old ARHIDOM screenshots were removed; an accurate
   RemHaOS replacement is uploaded and accepted. A dedicated
   reviewer account has been provisioned and its production password login was
   verified; reviewer contact data is saved.
3. DSA trader/non-trader status requires an explicit owner legal decision; it was
   not selected during this audit.

### P2 — follow-up

1. Support email still uses the historical `arhidom.space` domain. Change it
   only after a real `@remhaos.com` mailbox is provisioned and tested.
2. App icon is technically valid and contains no old wordmark, but should receive
   explicit RemHaOS brand acceptance before screenshots are produced.

## Verification evidence

| ID | Check | Expected | Actual | Environment | Confidence | Evidence |
|---|---|---|---|---|---|---|
| E-01 | Installed name | RemHaOS | source configured | Xcode source | verified | `Info.plist` |
| E-02 | Bundle identity | stable | `space.arhidom.ios` | Xcode/Capacitor | verified | project/config |
| E-03 | AASA source | valid App ID | route restored for RemHaOS host | Next.js source | verified | API route |
| E-04 | Privacy manifest | valid plist | present | native source | verified | `PrivacyInfo.xcprivacy` |
| E-05 | Real-device install/launch | signed build starts | PASS on two devices | physical iPhone 16 / 16 Pro Max | verified | CoreDevice install/launch |
| E-06 | Unsigned iPhone Release | compiles/validates | PASS | Xcode 26.6, iOS SDK 26.5 | verified | `/tmp/remhaos-derived/.../App.app` |
| E-07 | Production URLs | `/app`, AASA, support/privacy, health available | PASS | deployment `dpl_64aPi…` | verified | live HTTP |
| E-08 | Distribution signing | stable Team/App ID, production entitlements | PASS | App Store IPA | verified | embedded profile/codesign |
| E-09 | Simulator launch UI | no persistent blank screen | PASS after initial load | iPhone 17 Pro, iOS 26.5 | verified | `docs/release/evidence/...png` |
| E-10 | TestFlight upload | package accepted | PASS, build 1 ready for testing | App Store Connect | verified | build page |
| E-11 | Distribution binary state | confirmed | PASS | App Store Connect | verified | build metadata |
| E-12 | TestFlight testing notes | useful scoped checklist | PASS, RU notes saved | App Store Connect | verified | build page |
| E-13 | App Privacy publication | accurate declaration published | PASS, 14 linked data types; no tracking | App Store Connect | verified | privacy page |
| E-14 | Age rating | rating questionnaire complete | PASS, 4+ | App Store Connect | verified | app information |
| E-15 | Price and territories | launch scope configured | PASS, free; Russia only; iPhone only | App Store Connect | verified | pricing/availability |
| E-16 | Content rights | third-party content rights declared | PASS | App Store Connect | verified | app information |
| E-17 | Submission preflight | actionable remaining blockers | FAIL: screenshot processing and reviewer contact | App Store Connect | verified | version page |
| E-18 | Reviewer account | dedicated password account works | PASS, production login reaches `/dashboard` | `www.remhaos.com` | verified | browser QA |
| E-19 | Production Auth rebuild | correct Supabase configuration in compiled client | PASS | deployment `dpl_6Z8dw…` | verified | prebuilt Vercel deployment and login |
| E-20 | App Store screenshot | accurate 1242×2688 RemHaOS login screen | PASS, 1/10 | App Store Connect | verified | `01-remhaos-login.png` |
| E-21 | App Review submission | submitted and accepted into queue | PASS, Waiting for Review | App Store Connect | verified | submission `fc6f033b-20cf-4ae8-84f2-805993f4a614` |

## Store and compliance

| Area | Result | Notes |
|---|---|---|
| Monetization/IAP | PASS FOR V1 | price set to zero; no IAP submitted |
| Privacy | PUBLISHED | 14 linked data types disclosed; no tracking |
| Account deletion | SOURCE PRESENT | physical-device completion not verified |
| Metadata/locales | PASS FOR SUBMISSION | RemHaOS RU metadata and replacement screenshot saved |
| Countries/agreements | PARTIAL | Russia-only availability saved; DSA owner decision still pending |
| DSA | OWNER DECISION REQUIRED | do not infer trader status |
| Support/privacy URLs | PASS | both return 200 without authentication |
| Privacy Policy URL in console | PASS | `https://www.remhaos.com/legal/privacy` saved |
| Version build assignment | PASS | build 1 assigned to App Store version 1.0 |

## Automated checks

| Check | Result | Evidence |
|---|---|---|
| Release risk scan | PASS; no scanner findings | bundled release scanner |
| ESLint | PASS with 9 pre-existing warnings | `npm run lint` |
| Release association regression | PASS, 6/6 | targeted Vitest suite |
| Production dependency audit | PASS, 0 production vulnerabilities | `npm audit --omit=dev` |
| iOS plist/privacy/Xcode project | PASS | `plutil -lint` |
| Unsigned iPhone Release build | PASS | Xcode 26.6 / iOS SDK 26.5 |
| RemHaOS domain in built Capacitor config | PASS | `https://www.remhaos.com/app` |
| Full test suite | PASS, 398/398 | `npm run test` |
| Next.js production build | PASS locally and on Vercel | Next.js 16.2.12 |
| TypeScript | PASS | `npm run typecheck` |
| Signed Archive | PASS | `/tmp/RemHaOS.xcarchive` |
| App Store IPA export | PASS | `/tmp/RemHaOS-AppStore/App.ipa` |
| App Store Connect upload | PASS | build 1 confirmed and ready for testing |
| Distribution entitlements | PASS | Team/App ID, `get-task-allow=false`, Associated Domains verified in App Store Connect |
| Export compliance metadata | PASS | App Store Connect reports no non-exempt encryption |

## Not checked

- clean-install and upgrade-install paths (installation was performed without
  uninstalling or clearing existing device data);
- authenticated production workflows beyond reviewer login;
- physical-device visual/account deletion/Universal Link matrix;
- agreements and DSA status;
- TestFlight invitation/install path; no groups or individual testers are
  currently assigned to build 1.

## Owner confirmations required

1. Explicitly choose DSA trader/non-trader after legal assessment.
2. Provide/confirm a complete postal address for the data operator.
3. Provision and test the intended `@remhaos.com` support mailbox, or explicitly
   retain the working historical support address.
4. Repair Supabase confirmation-email delivery for ordinary self-registration.
   A dedicated confirmed App Review account is already provisioned and verified.

## Next actions

1. Freeze the verified source in a release commit and reconcile it to deployment
   `dpl_64aPiWxq8g2xxAg8RFZ3YrA3nF78` and uploaded build 1.
2. Assign an internal tester and install build 1 from TestFlight.
3. Execute authenticated physical-device QA, especially account deletion and
   Universal Links.
4. Monitor App Review messages and respond without changing the submitted build
   unless Apple requests a new binary.
5. After approval, complete the manual release only after a final production
   smoke test and owner approval.
