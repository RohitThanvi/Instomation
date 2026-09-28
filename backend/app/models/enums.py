from enum import StrEnum


class AccountType(StrEnum):
    CREATOR = "creator"
    BUSINESS = "business"
    AGENCY = "agency"
    PERSONAL_BRAND = "personal_brand"
    OTHER = "other"


class MemberRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MANAGER = "manager"
    STAFF = "staff"


class InstagramAccountStatus(StrEnum):
    ACTIVE = "active"
    TOKEN_EXPIRED = "token_expired"  # noqa: S105 - status label, not a credential
    DISCONNECTED = "disconnected"


class ConversationState(StrEnum):
    AI_ACTIVE = "ai_active"
    HUMAN_REQUIRED = "human_required"
    HUMAN_ACTIVE = "human_active"
    RESOLVED = "resolved"


class Priority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"


class MessageDirection(StrEnum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class MessageOrigin(StrEnum):
    """Who authored a message. Used for loop protection and analytics."""

    CUSTOMER = "customer"
    AI = "ai"
    HUMAN = "human"
    INTERNAL_NOTE = "internal_note"


class DeliveryStatus(StrEnum):
    RECEIVED = "received"
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    SUPPRESSED = "suppressed"


class Intent(StrEnum):
    GREETING = "greeting"
    PRODUCT_QUERY = "product_query"
    PRICE_QUERY = "price_query"
    SERVICE_QUERY = "service_query"
    ORDER_QUERY = "order_query"
    SHIPPING_QUERY = "shipping_query"
    BOOKING_QUERY = "booking_query"
    COLLABORATION = "collaboration"
    SPONSORSHIP = "sponsorship"
    AFFILIATE = "affiliate"
    COMPLAINT = "complaint"
    SUPPORT = "support"
    GENERAL_QUESTION = "general_question"
    POSITIVE_COMMENT = "positive_comment"
    NEGATIVE_COMMENT = "negative_comment"
    SPAM = "spam"
    SEXUAL = "sexual"
    OFFENSIVE = "offensive"
    HARASSMENT = "harassment"
    UNCERTAIN = "uncertain"
    HUMAN_REQUIRED = "human_required"


class CommentAction(StrEnum):
    IGNORE = "ignore"
    LIKE = "like"
    REPLY = "reply"
    DM_IF_PERMITTED = "dm_if_permitted"
    ESCALATE = "escalate"


class ProcessingStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class CommunicationStyle(StrEnum):
    STRICT_BUSINESS = "strict_business"
    PROFESSIONAL = "professional"
    MODERATELY_CASUAL = "moderately_casual"
    FRIENDLY = "friendly"


class KnowledgeKind(StrEnum):
    FAQ = "faq"
    PRODUCT = "product"
    SERVICE = "service"
    POLICY = "policy"
    WEBSITE = "website"
    CUSTOM = "custom"


class HandoffReason(StrEnum):
    CUSTOMER_REQUESTED = "customer_requested"
    COMPLAINT = "complaint"
    REFUND_DISPUTE = "refund_dispute"
    LEGAL = "legal"
    THREAT = "threat"
    HIGH_VALUE_LEAD = "high_value_lead"
    COLLABORATION = "collaboration"
    LOW_CONFIDENCE = "low_confidence"
    MISSING_INFORMATION = "missing_information"
    REPEATED_DISSATISFACTION = "repeated_dissatisfaction"
    MANUAL = "manual"


class HandoffStatus(StrEnum):
    OPEN = "open"
    ASSIGNED = "assigned"
    RESOLVED = "resolved"


class SubscriptionStatus(StrEnum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"


class BillingInterval(StrEnum):
    MONTHLY = "monthly"
    ANNUAL = "annual"
