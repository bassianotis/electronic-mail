# Sync test scenarios

The harness test plan. Each scenario is a scripted sequence against the Docker Dovecot harness (`npm run harness:up`), ending in the assertion **engine cache == server**, plus the rule-specific checks.

**Source:** scenario *ideas and names* come from Mailspring-Sync's black-box suite (`test/scenarios/`, PR #144, Sept 2026). Each one is a bug a mature client actually hit. We reimplement them from the descriptions; no code is copied (see `docs/architecture.md`). Provider-specific scenarios (Gmail labels, NetEase, O365, Proton, Courier) are left out until we support those providers.

Status: ✅ passing · ⬜ not yet written

## Harness primitives
| Scenario | Rule | Status |
|---|---|---|
| Test server matches the live host's shape (capabilities, `INBOX.` namespace) | — | ✅ |
| MOVE keeps keywords + returns COPYUID (migration reversible) | 7 | ✅ |
| QRESYNC reports messages removed by another client while away | 4, 5 | ✅ |

## Initial sync & checkpoints
| Scenario | Rule | Status |
|---|---|---|
| baseline-initial-sync | 4 | ✅ |
| condstore-initial-sync-large (≈15k msgs in one INBOX) | 3, 4 | ⬜ |
| sparse-uid-space | 4 | ⬜ |
| status-uidnext-zero-new-mail | 5 | ⬜ |
| modseq-truncation (don't advance HIGHESTMODSEQ past unseen changes) | 4 | ⬜ |
| heavy-fetch-truncation-backlog | 4 | ⬜ |
| messagelimit-partial-fetch | 3, 4 | ⬜ |
| uidvalidity-change | 4 | ✅ |
| uidvalidity-change-large-mailbox | 3, 4 | ⬜ |
| missing-message-id (ours: synthetic ID, never duplicated; from the 12,455-copy bug) | 4 | ✅ |
| unparseable-date-header (ours: 9 real messages; store null, sort by INTERNALDATE) | 4 | ✅ |
| recent-flag-never-stored (ours: `\Recent` is per-session; storing it broke cache==server) | 4 | ✅ |
| sent-view-lists-replied-threads (ours) | 2 | ✅ |
| foreign-keywords-untouched (ours: `$Forwarded`, `$MailFlagBit0`, `NonJunk` survive every action) | 4 | ✅ |

## Live changes (IDLE / QRESYNC)
| Scenario | Rule | Status |
|---|---|---|
| new-mail-during-idle | 5 | ✅ |
| remote-flag-changes | 5 | ✅ |
| remote-move-to-archive | 5 | ✅ |
| remote-move-destination-scanned-first | 4 | ⬜ |
| remote-move-while-task-in-flight | 4, 8 | ✅ |
| qresync-bulk-expunge-during-idle | 4 | ⬜ |
| qresync-two-expunges-during-idle | 4 | ⬜ |
| qresync-vanished-above-highest-uid | 4 | ⬜ |
| qresync-vanished-during-body-fetch | 4 | ⬜ |
| qresync-wide-vanished-range | 4 | ✅ |
| plain-expunge-found-by-deep-scan | 4 | ⬜ |
| orphan-sweep-waits-for-initial-walk | 4 | ⬜ |
| orphan-sweep-with-unreadable-folder | 4 | ⬜ |
| mid-pass-foreground-tombstone | 4 | ⬜ |
| folder-deleted (ours: placements and orphaned facts pruned) | 4 | ✅ |
| folder-deleted-with-copies-elsewhere | 4 | ⬜ |

## Placements (one message, several folders)
| Scenario | Rule | Status |
|---|---|---|
| self-addressed-inbox-and-sent | 1, 4 | ✅ |
| two-folders-identical-messages | 4 | ⬜ |
| flag-change-on-second-placement | 4 | ⬜ |
| mark-read-fans-out-to-all-placements | 2 | ✅ |
| move-into-folder-holding-a-copy | 4 | ⬜ |
| trash-message-with-two-placements | 4 | ⬜ |

## User actions (tasks)
| Scenario | Rule | Status |
|---|---|---|
| client-task-move | 1, 8 | ✅ |
| thread-move-ends-whole (ours: failure mid-thread rolls back) | 1 | ✅ |
| move-rejected-by-server | 8 | ✅ |
| move-with-permuted-copyuid | 4 | ⬜ |
| undo-before-remote-phase | 8 | ✅ |
| undo-move-restores-placements | 8 | ✅ |
| client-task-trash-and-expunge | 4 | ⬜ |
| task-failure-never-wedges-queue (ours: Mailspring PR #143) | 6 | ✅ |

## Connection trouble
| Scenario | Rule | Status |
|---|---|---|
| connection-dropped-during-command | 6 | ⬜ |
| connection-dropped-during-idle | 6 | ✅ |
| list-refused-transiently | 6 | ⬜ |
| restart-mid-sync-resumes-from-checkpoint (ours) | 6 | ⬜ |
| restart-resumes-pending-task (ours) | 6 | ✅ |
| auth-failure-stops-retrying (ours: protects against the host's brute-force lockout) | 6 | ✅ |
| background-check-finds-changes-in-other-folders (ours) | 5 | ✅ |
| verification-repairs-drifted-cache (ours: daily deep scan) | 4 | ✅ |
| queued-move-confirmed-within-2s (ours) | 8 | ✅ |
| transient-failure-retried (ours) | 6 | ✅ |

## Sending & drafts
| Scenario | Rule | Status |
|---|---|---|
| send (one delivery; Bcc hidden from recipients, kept in your Sent copy; attachments; sent view) | 9 | ✅ |
| send-draft | 9 | ⬜ |
| sent-copy-saved-late (APPEND worked but its acknowledgement was lost: retried, still one copy) | 9 | ✅ |
| sent-copy-multisend | 9 | ⬜ |
| sent-copy-multisend-late | 9 | ⬜ |
| sent-copy-cleanup-store-refused | 9 | ⬜ |
| reply-joins-thread (In-Reply-To + References from the stored original) (ours) | 1, 9 | ✅ |
| forward-carries-attachments (ours) | 9 | ✅ |
| smtp-temporary-retried / permanent-fails-once-with-reason / bad-password-explained (ours) | 9 | ✅ |
| crash-mid-send-is-uncertain-never-auto-resent (ours) | 9 | ✅ |
| header-injection-in-subject-neutralised (ours) | 10 | ✅ |
| reader-sees-just-arrived-mail (stale-view regression: NOOP before reading an open folder) | 4 | ✅ |
| synced-draft-destroy (sending a draft removes every version, after the Sent copy is saved) | 9 | ✅ |
| draft-autosave-replaces-versions (one version on the server; fields and attachments round-trip) (ours) | 9 | ✅ |
| foreign-draft-continued-is-replaced / unrelated-foreign-draft-untouched (ours) | 9 | ✅ |
| no-uidplus-refuses-to-expunge (never a plain EXPUNGE that could erase another app's \\Deleted mail) (ours) | 4 | ✅ (guard) |

## Folders & rules
| Scenario | Rule | Status |
|---|---|---|
| folder-roles-by-localized-name (some hosts don't advertise SPECIAL-USE) | 5 | ⬜ |
| rules-ready-incoming (sender rules file new Inbox arrivals, exact address or @domain) | — | ✅ |
| rules-ready-across-restart | 6 | ⬜ |
| rules-ready-self-addressed-send | — | ⬜ |
| rules-never-retroactive (first sync / cache rebuild do not file existing mail) (ours) | — | ✅ |
| rules-never-against-the-user (dragged back to Inbox stays) (ours) | — | ✅ |
| rules-see-arrivals-synced-by-any-job (race found under load: arrivals synced inside a move task were never rule-checked) (ours) | — | ✅ |

## Threading & counts (ours)
| Scenario | Rule | Status |
|---|---|---|
| out-of-order-arrival-joins-thread (from the 34 split conversations) | 1 | ✅ |
| same-subject-same-sender-stays-separate (from the 245-card stack) | 1 | ✅ |
| address-in-in-reply-to-ignored | 1 | ✅ |
| new-reply-on-filed-thread-returns-to-inbox | 1 | ✅ |
| counts-equal-list-length-after-random-ops (property test) | 2 | ✅ |
| incremental-threads-equal-full-rebuild (oracle, checked after every random step) | 1 | ✅ |
| bridging-message-merges-threads (ours) | 1 | ✅ |
| incremental-out-of-order (child, then parent, then grandparent) | 1 | ✅ |

## Search
| Scenario | Rule | Status |
|---|---|---|
| accents folded, prefixes, sender name/address, all words required | — | ✅ |
| one card per conversation; Junk/Trash excluded; one-folder filter | 2 | ✅ |
| previews searchable as soon as fetched (FTS triggers) | — | ✅ |
| typed FTS syntax never interpreted | 10 | ✅ |
