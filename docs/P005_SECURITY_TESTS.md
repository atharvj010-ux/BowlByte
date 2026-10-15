# P005 security and concurrency tests

All cases below run on real PostgreSQL (`bowlbyte_test`) and Redis, through the FastAPI test client, unless marked unit. They are in `backend/tests/test_cash_pickup_integration.py` (59 tests) and `backend/tests/test_pickup_push_unit.py` (16 tests). The Playwright cases are in `frontend/e2e/cash-pickup.spec.ts`.

## Cash

| Rule | Test |
| --- | --- |
| Only a cashier records cash. Student, kitchen and manager get 403. Missing CSRF gets 403 | `test_only_cashier_can_record_cash` |
| Cash needs a READY order | `test_cash_requires_ready_order` |
| Receipt, audit row and order event are written. The order stays READY | `test_confirm_cash_records_receipt_audit_and_keeps_order_ready` |
| Amount must equal the stored total in integer paise | `test_amount_must_match_stored_total_in_integer_paise` |
| Retry with the same key returns the same receipt. A new key on a paid order is refused | `test_cash_retry_is_idempotent_and_second_attempt_is_rejected` |
| Concurrent confirmations create one receipt | `test_concurrent_cash_confirmations_create_one_receipt` |
| A cashier cannot touch another canteen | `test_cashier_is_limited_to_their_own_canteen` |
| Payment status cannot be set by student or order endpoints | `test_payment_cannot_be_set_through_order_or_student_endpoints` |
| Only a manager reverses. The receipt is kept | `test_only_manager_reverses_cash_and_receipt_is_preserved` |
| Reversal is refused after pickup | `test_reversal_is_blocked_after_pickup` |
| Receipts, reversals and pickup events cannot be updated or deleted | `test_cash_ledgers_and_pickup_events_are_append_only` |
| Cash responses are not cacheable | `test_cash_endpoints_are_not_cacheable` |
| Summaries separate order value, cash and reversals | `test_cashier_board_and_manager_summary_separate_value_cash_and_reversals` |

## Pickup credentials

| Rule | Test |
| --- | --- |
| Issued only to the owner of a READY order | `test_credential_is_issued_only_for_own_ready_order` |
| Only hashes are stored | `test_only_hashes_of_credentials_are_stored` |
| Re-issuing revokes the earlier credential | `test_reissue_revokes_the_earlier_credential` |
| Issuing is rate limited | `test_issue_requests_are_rate_limited` |
| Verify never marks PAID or consumes the credential | `test_scanning_never_marks_paid_or_consumes_the_credential` |
| Handover needs recorded cash | `test_handover_requires_recorded_cash` |
| Full flow records cashier, events and PICKED_UP | `test_full_pickup_records_cashier_events_and_completes_status` |
| Never redeemed twice | `test_credential_can_never_be_redeemed_twice` |
| Concurrent redemptions: exactly one wins | `test_concurrent_redemptions_allow_exactly_one` |
| Expired credentials are refused | `test_expired_credential_is_rejected` |
| Manual code with ticket works and is normalised | `test_manual_code_works_with_ticket_and_is_normalised` |
| Wrong codes are rate limited | `test_wrong_manual_codes_are_rate_limited` |
| Other-canteen credentials look unknown | `test_other_canteen_credentials_look_unknown` |
| Entropy, normalisation, keyed hash (unit) | `test_tokens_and_codes_are_high_entropy_and_unique`, `test_code_normalisation_accepts_human_input_only`, `test_keyed_hash_is_deterministic_and_key_dependent` |

## Notifications and push

| Rule | Test |
| --- | --- |
| READY creates one notification and one outbox row | `test_ready_creates_exactly_one_notification_and_outbox_row` |
| In-app notifications are private and markable | `test_in_app_notifications_are_private_and_markable` |
| Unsafe endpoints are rejected (SSRF) | `test_unsafe_push_endpoints_are_rejected`, `test_endpoint_validation_rejects_unsafe_urls` (unit) |
| Real push hosts pass validation | `test_real_push_hosts_are_accepted_by_validation` |
| Test host needs explicit opt-in. Production refuses it and default secrets | `test_test_hosts_are_blocked_unless_explicitly_enabled`, `test_simulator_host_requires_explicit_opt_in`, `test_production_refuses_test_endpoints_and_default_secrets`, `test_simulator_is_never_selected_for_real_hosts` |
| Invalid keys are rejected | `test_invalid_subscription_keys_are_rejected`, `test_key_validation_checks_curve_point_and_auth_length` |
| Subscriptions are encrypted, owned and movable | `test_subscriptions_are_encrypted_owned_and_movable` |
| Subscription routes need a student session and CSRF | `test_subscription_endpoints_require_student_session_and_csrf` |
| Accepted is never reported as displayed | `test_push_delivery_is_accepted_but_never_claimed_displayed` |
| 410 disables the subscription and is not retried | `test_gone_subscription_is_disabled_and_not_retried` |
| Failure never reverses READY. Backoff works | `test_failed_push_never_reverses_ready_and_retries_with_backoff` |
| A flaky service succeeds on retry | `test_flaky_push_service_succeeds_on_retry` |
| 429 honours Retry-After. Timeouts retry | `test_throttled_push_honours_retry_after_and_timeouts_are_retried` |
| Outbox survives restart. Stale claims expire | `test_outbox_survives_restart_and_stale_claims_expire` |
| Two workers do not double-deliver | `test_two_workers_do_not_double_deliver` |
| A collected order's READY push is skipped | `test_stale_ready_event_is_skipped_after_pickup` |
| No device still leaves the in-app record | `test_no_subscription_still_leaves_in_app_notification` |
| Account switch does not leak to the next user | `test_account_switch_does_not_leak_notifications_to_the_next_user`, `test_takeover_after_scheduling_skips_the_pending_delivery` |
| Test push is protected and rate limited | `test_push_test_endpoint_is_protected_and_rate_limited` |
| Real transport signs VAPID and encrypts the payload (aes128gcm) with no device | `test_real_webpush_transport_signs_vapid_and_encrypts_payload` |
| Real transport surfaces status codes and Retry-After, refuses private addresses, maps network errors | `test_real_webpush_transport_surfaces_status_and_retry_after`, `test_real_transport_refuses_private_addresses_and_missing_keys`, `test_real_transport_maps_network_errors` |

## Frontend unit tests

`src/lib/cash.test.ts` (separate pending, paid and picked-up wording, an unpaid ready order never shown as paid, request keys, integer-paise schemas), `src/components/cashier/qr-scanner.test.tsx` (no camera until the button is pressed, one scan then stop, denied camera, missing camera, secure context), `src/lib/push.test.ts` (support detection, VAPID key decoding, iPhone guidance, and the service worker: it precaches only the offline page and an icon, ignores API calls, shows a ready notification, rejects hostile click paths).

## What these do not show

They do not show that a phone received or displayed anything. The real transport test proves the request is correctly signed and encrypted. It does not reach a push service.
