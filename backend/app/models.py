import enum
from sqlalchemy import (
    Column,
    Date,
    Integer,
    String,
    Numeric,
    DateTime,
    ForeignKey,
    Enum,
    Index,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class TransactionType(str, enum.Enum):
    DEBIT = "DEBIT"
    CREDIT = "CREDIT"


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    type = Column(String(50), nullable=False)  # Ex: BANK, CREDIT
    balance = Column(Numeric(14, 2), nullable=False, default=0.00)
    currency = Column(String(10), nullable=False, default="BRL")
    pluggy_account_id = Column(String(100), unique=True, nullable=False, index=True)
    # Datas reais do cartão vindas de creditData (Pluggy); nulas para contas BANK
    bill_close_date = Column(Date, nullable=True)
    bill_due_date = Column(Date, nullable=True)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    transactions = relationship(
        "Transaction", back_populates="account", cascade="all, delete-orphan"
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(
        Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount = Column(Numeric(14, 2), nullable=False)
    date = Column(DateTime(timezone=True), nullable=False, index=True)
    description = Column(String(500), nullable=False)
    merchant_name = Column(String(255), nullable=True)
    merchant_cnpj = Column(String(30), nullable=True)
    category = Column(String(120), nullable=True, index=True)
    type = Column(Enum(TransactionType, name="transaction_type_enum"), nullable=False)
    pluggy_transaction_id = Column(String(100), unique=True, nullable=False, index=True)
    is_ignored = Column(Integer, default=0, nullable=False)
    # creditCardMetadata (Pluggy): fatura a que a compra pertence e parcela
    bill_id = Column(String(100), nullable=True, index=True)
    installment_number = Column(Integer, nullable=True)
    total_installments = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    account = relationship("Account", back_populates="transactions")

    __table_args__ = (
        Index("ix_transactions_date_category", "date", "category"),
    )


class CreditCardBill(Base):
    """Fatura fechada do cartão, como retornada por GET /bills da Pluggy."""

    __tablename__ = "credit_card_bills"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(
        Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pluggy_bill_id = Column(String(100), unique=True, nullable=False, index=True)
    due_date = Column(Date, nullable=False, index=True)
    closing_date = Column(Date, nullable=True)
    total_amount = Column(Numeric(14, 2), nullable=False)
    minimum_payment_amount = Column(Numeric(14, 2), nullable=True)
    paid_amount = Column(Numeric(14, 2), nullable=False, default=0.00)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RecurringBill(Base):
    __tablename__ = "recurring_bills"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    due_day = Column(Integer, nullable=False, default=10)
    category = Column(String(120), nullable=False, default="Outros")
    is_active = Column(Integer, nullable=False, default=1)
    last_paid_month = Column(String(7), nullable=True)  # e.g. "2026-10"
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class FinancialGoal(Base):
    __tablename__ = "financial_goals"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    current_amount = Column(Numeric(14, 2), nullable=False, default=0.00)
    target_amount = Column(Numeric(14, 2), nullable=False, default=1000.00)
    color = Column(String(50), nullable=False, default="emerald")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Caixinha(Base):
    __tablename__ = "caixinhas"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)
    balance = Column(Numeric(14, 2), nullable=False, default=0.00)
    include_in_free_balance = Column(Integer, nullable=False, default=0)
    linked_goal_id = Column(
        Integer, ForeignKey("financial_goals.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    goal = relationship("FinancialGoal")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(String(100), primary_key=True, index=True)
    value = Column(String(1000), nullable=True)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
