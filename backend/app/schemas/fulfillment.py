from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

KEY_PATTERN = r"^[A-Za-z0-9_-]{8,80}$"


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Out(BaseModel):
    model_config = ConfigDict(extra="ignore")


# --- Cashier -----------------------------------------------------------------------------


class CounterPayment(_Out):
    method: Literal["CASH"]
    status: Literal["PENDING", "PAID", "VOIDED"]
    amount_paise: int
    paid_at: datetime | None = None
    receipt_ref: str | None = None


class CounterItem(_Out):
    item_name: str
    quantity: int


class CounterOrder(_Out):
    id: UUID
    ticket_number: str
    status: str
    version: int
    total_paise: int
    ready_at: datetime | None
    picked_up_at: datetime | None
    student_first_name: str | None
    payment: CounterPayment
    items: list[CounterItem]


class CashierTotals(_Out):
    awaiting_payment_paise: int
    recorded_today_paise: int
    window_note: str


class CashierBoardResponse(_Out):
    awaiting_payment: list[CounterOrder]
    awaiting_handover: list[CounterOrder]
    completed: list[CounterOrder]
    totals: CashierTotals


class ReversalInfo(_Out):
    id: UUID
    amount_paise: int
    kind: str
    reason: str
    reversed_at: datetime
    manager_name: str | None


class ReceiptResponse(_Out):
    id: UUID
    receipt_no: int
    receipt_ref: str
    order_id: UUID
    ticket_number: str
    amount_paise: int
    cashier_user_id: UUID
    cashier_name: str | None
    received_at: datetime
    reversed: bool
    reversal: ReversalInfo | None


class ConfirmCashRequest(_In):
    amount_paise: int = Field(ge=1, le=10_000_000)
    idempotency_key: str = Field(pattern=KEY_PATTERN)


class ConfirmCashResponse(_Out):
    receipt: ReceiptResponse
    order: CounterOrder
    replayed: bool


class PickupVerifyRequest(_In):
    token: str | None = Field(default=None, max_length=128)
    ticket_number: str | None = Field(default=None, max_length=24)
    code: str | None = Field(default=None, max_length=24)

    @field_validator("token", "ticket_number", "code")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @model_validator(mode="after")
    def _one_method(self) -> "PickupVerifyRequest":
        if self.token and (self.code or self.ticket_number):
            raise ValueError("Send either a scanned code or a ticket with a manual code.")
        if not self.token and not (self.code and self.ticket_number):
            raise ValueError("Scan the QR code or enter the ticket number and manual code.")
        return self


class PickupVerifyResponse(_Out):
    order: CounterOrder
    credential_id: UUID
    credential_expires_at: datetime
    can_confirm_cash: bool
    can_complete_pickup: bool


class CompletePickupRequest(_In):
    token: str | None = Field(default=None, max_length=128)
    code: str | None = Field(default=None, max_length=24)
    idempotency_key: str = Field(pattern=KEY_PATTERN)

    @model_validator(mode="after")
    def _one_method(self) -> "CompletePickupRequest":
        if bool(self.token) == bool(self.code):
            raise ValueError("Send either the scanned code or the manual code.")
        return self


class CompletePickupResponse(_Out):
    order: CounterOrder
    replayed: bool


class CashierHistoryResponse(_Out):
    transactions: list[ReceiptResponse]
    total: int
    limit: int
    offset: int


# --- Student pickup ----------------------------------------------------------------------


class PickupCredentialResponse(_Out):
    credential_id: UUID
    order_id: UUID
    ticket_number: str
    token: str
    code: str
    issued_at: datetime
    expires_at: datetime
    replaced_previous: bool


class PickupStatusResponse(_Out):
    order_id: UUID
    order_status: str
    state: Literal["NOT_READY", "AVAILABLE", "ACTIVE", "EXPIRED", "COLLECTED"]
    can_request: bool
    credential_expires_at: datetime | None
    payment_status: str
    paid_at: datetime | None
    picked_up_at: datetime | None


# --- Manager cash ------------------------------------------------------------------------


class ReverseCashRequest(_In):
    reason: str = Field(min_length=5, max_length=300)
    kind: Literal["CASH_RETURNED", "ERRONEOUS_ENTRY"]
    confirm: Literal[True]
    idempotency_key: str = Field(pattern=KEY_PATTERN)

    @field_validator("reason")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 5:
            raise ValueError("Give a reason of at least 5 characters.")
        return value


class ReverseCashResponse(_Out):
    receipt: ReceiptResponse
    replayed: bool


class CashSummaryNotes(_Out):
    recorded: str
    pending: str
    reconciliation: str


class CashSummaryResponse(_Out):
    from_date: date
    to_date: date
    timezone_note: str
    orders_placed: int
    orders_placed_value_paise: int
    paid_orders: int
    receipts_recorded: int
    gross_receipts_paise: int
    reversals_recorded: int
    reversed_paise: int
    net_cash_paise: int
    ready_awaiting_payment: int
    ready_awaiting_payment_paise: int
    paid_awaiting_pickup: int
    paid_awaiting_pickup_paise: int
    picked_up_orders: int
    picked_up_value_paise: int
    notes: CashSummaryNotes


# --- Push and notifications --------------------------------------------------------------


class PushKeys(_In):
    p256dh: str = Field(min_length=1, max_length=120)
    auth: str = Field(min_length=1, max_length=64)


class PushSubscribeRequest(_In):
    endpoint: str = Field(min_length=1, max_length=1024)
    keys: PushKeys
    expiration_time: int | None = Field(default=None, ge=0)
    device_label: str | None = Field(default=None, max_length=60)


class PushUnsubscribeRequest(_In):
    endpoint: str = Field(min_length=1, max_length=1024)


class PushPublicKeyResponse(_Out):
    supported: bool
    public_key: str | None


class PushSubscriptionResponse(_Out):
    id: UUID
    device_label: str | None
    enabled: bool
    disabled_reason: str | None
    created_at: datetime
    last_success_at: datetime | None
    last_attempt_at: datetime | None


class PushSubscribeResponse(_Out):
    subscription: PushSubscriptionResponse
    created: bool


class PushTestResponse(_Out):
    event_id: UUID
    state: Literal["QUEUED"]
    note: str = "Queued. The push service accepting it does not prove the device displayed it."


class NotificationResponse(_Out):
    id: UUID
    kind: str
    title: str
    body: str
    order_id: UUID | None
    created_at: datetime
    read_at: datetime | None
    read: bool


class NotificationListResponse(_Out):
    items: list[NotificationResponse]
    unread_count: int


class NotificationReadResponse(_Out):
    notification: NotificationResponse
    unread_count: int


class UnreadResponse(_Out):
    unread_count: int
