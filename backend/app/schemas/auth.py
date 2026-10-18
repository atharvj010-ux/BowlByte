import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

_ROLL = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,31}$")


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StudentRegisterRequest(APIModel):
    full_name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    roll_number: str = Field(min_length=3, max_length=32)
    enrollment_code: str | None = Field(default=None, max_length=128)
    password: str = Field(min_length=12, max_length=128)
    confirm_password: str = Field(min_length=12, max_length=128)

    @field_validator("full_name", "roll_number")
    @classmethod
    def strip_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("This field is required.")
        return stripped

    @field_validator("roll_number")
    @classmethod
    def check_roll(cls, value: str) -> str:
        normalized = "".join(value.upper().split())
        if _ROLL.fullmatch(normalized) is None:
            raise ValueError("Enter the college roll number using letters, digits, or hyphens.")
        return normalized

    @model_validator(mode="after")
    def passwords_match(self) -> "StudentRegisterRequest":
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match.")
        return self


class LoginRequest(APIModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class VerifyEmailRequest(APIModel):
    token: str = Field(min_length=20, max_length=200)


class ResendVerificationRequest(APIModel):
    email: EmailStr


class ForgotPasswordRequest(APIModel):
    email: EmailStr


class EmailOtpRequest(APIModel):
    email: EmailStr


class EmailOtpVerifyRequest(APIModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=12)


class ResetPasswordRequest(APIModel):
    token: str = Field(min_length=20, max_length=8192)
    password: str = Field(min_length=12, max_length=128)
    confirm_password: str = Field(min_length=12, max_length=128)

    @model_validator(mode="after")
    def passwords_match(self) -> "ResetPasswordRequest":
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match.")
        return self


class AcceptInvitationRequest(APIModel):
    token: str = Field(min_length=20, max_length=200)
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=128)
    confirm_password: str = Field(min_length=12, max_length=128)

    @field_validator("full_name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("This field is required.")
        return stripped

    @model_validator(mode="after")
    def passwords_match(self) -> "AcceptInvitationRequest":
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match.")
        return self


class InvitationCreateRequest(APIModel):
    email: EmailStr
    role: Literal["KITCHEN_STAFF", "CASHIER"]


class StaffStatusRequest(APIModel):
    status: Literal["active", "inactive"]


class UserResponse(BaseModel):
    id: UUID
    full_name: str
    email: str
    role: str
    status: str
    canteen_id: UUID | None


class UserEnvelope(BaseModel):
    user: UserResponse


class MessageResponse(BaseModel):
    message: str


class RegistrationPolicyResponse(BaseModel):
    mode: str
    open: bool
    college_name: str
    email_domain: str | None
    enrollment_code_required: bool


class CsrfResponse(BaseModel):
    csrf_token: str


class StaffMemberResponse(BaseModel):
    id: UUID
    full_name: str
    email: str
    role: str
    status: str
    canteen_id: UUID


class StaffListResponse(BaseModel):
    staff: list[StaffMemberResponse]


class InvitationResponse(BaseModel):
    id: UUID
    email: str
    role: str
    expires_at: datetime
