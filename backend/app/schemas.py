from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, ConfigDict

from app.models import TransactionType


class AccountResponse(BaseModel):
    id: int
    name: str
    type: str
    balance: Decimal
    currency: str
    pluggy_account_id: str

    model_config = ConfigDict(from_attributes=True)


class TransactionResponse(BaseModel):
    id: int
    account_id: int
    account_name: Optional[str] = None
    account_type: Optional[str] = None
    amount: Decimal
    date: datetime
    description: str
    merchant_name: Optional[str] = None
    merchant_cnpj: Optional[str] = None
    category: Optional[str] = None
    type: TransactionType
    pluggy_transaction_id: str
    is_ignored: bool = False

    model_config = ConfigDict(from_attributes=True)


class TransactionUpdateSchema(BaseModel):
    category: Optional[str] = None
    is_ignored: Optional[bool] = None


class PaginatedTransactionsResponse(BaseModel):
    items: List[TransactionResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class CategoryExpense(BaseModel):
    category: str
    total: float


class FutureCommitmentItem(BaseModel):
    month: str
    label: str
    total: float
    count: int


class SalaryProjection(BaseModel):
    salary: float
    bank_balance: float
    credit_balance: float
    current_bill: float
    recurring_bills_total: float = 0.0
    recurring_bills_pending: float = 0.0
    caixinhas_liquid_total: float = 0.0
    caixinhas_total: float = 0.0
    is_bill_custom: bool = False
    bill_closing_day: int = 2
    bill_due_day: int = 7
    bill_cycle_start: str = ""
    bill_cycle_end: str = ""
    bill_status: str = "OPEN"  # CLOSED = fechada aguardando pagamento; OPEN = aberta
    bill_source: str = "CALCULATED"  # PLUGGY = fatura oficial via /bills
    bill_due_date: str = ""
    bill_closed_amount: float = 0.0
    bill_open_amount: float = 0.0
    total_available: float
    free_balance: float
    days_remaining: int = 30
    commitment_percentage: float
    daily_budget: float
    status: str  # "CRITICAL", "WARNING", "HEALTHY"


class CaixinhaResponse(BaseModel):
    id: int
    name: str
    balance: float
    include_in_free_balance: bool
    linked_goal_id: Optional[int] = None
    linked_goal_name: Optional[str] = None
    updated_at: Optional[datetime] = None


class AppSettingsResponse(BaseModel):
    user_name: str = ""
    user_salary: float = 0.0
    pluggy_configured: bool = False
    pluggy_client_id: str = ""
    pluggy_item_id: Optional[str] = None


class AppSettingsUpdate(BaseModel):
    user_name: Optional[str] = None
    pluggy_client_id: Optional[str] = None
    pluggy_client_secret: Optional[str] = None


class CaixinhaUpdate(BaseModel):
    balance: Optional[float] = None
    include_in_free_balance: Optional[bool] = None
    linked_goal_id: Optional[int] = None


class CaixinhaCreate(BaseModel):
    name: str
    balance: float = 0.0
    include_in_free_balance: bool = False
    linked_goal_id: Optional[int] = None


class RecurringBillCreate(BaseModel):
    name: str
    amount: float
    due_day: int = 10
    category: str = "Outros"


class RecurringBillUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    due_day: Optional[int] = None
    category: Optional[str] = None
    is_active: Optional[bool] = None


class RecurringBillResponse(BaseModel):
    id: int
    name: str
    amount: float
    due_day: int
    category: str
    is_active: bool
    is_paid_this_month: bool = False
    created_at: Optional[datetime] = None


class RecurringBillsSummary(BaseModel):
    total_monthly: float
    total_paid: float
    total_pending: float
    items: List[RecurringBillResponse]


class SalaryUpdateRequest(BaseModel):
    salary: float


class CardSettings(BaseModel):
    closing_day: int = 2
    due_day: int = 7
    custom_bill_amount: Optional[float] = None


class CardSettingsUpdateRequest(BaseModel):
    closing_day: Optional[int] = None
    due_day: Optional[int] = None
    custom_bill_amount: Optional[float] = None
    use_auto_bill: Optional[bool] = False


class DashboardMetricsResponse(BaseModel):
    bank_balance: float
    credit_balance: float
    net_balance: float
    current_balance: float
    monthly_income: float
    monthly_expenses: float
    future_commitments_total: float
    future_commitments: List[FutureCommitmentItem]
    expenses_by_category: List[CategoryExpense]
    accounts: List[AccountResponse]
    salary_projection: SalaryProjection


class SyncResponse(BaseModel):
    status: str
    accounts_synced: int
    transactions_upserted: int
    message: str


class FinancialGoalCreate(BaseModel):
    name: str
    current_amount: float = 0.0
    target_amount: float
    color: str = "emerald"


class FinancialGoalUpdate(BaseModel):
    name: Optional[str] = None
    current_amount: Optional[float] = None
    target_amount: Optional[float] = None
    color: Optional[str] = None


class FinancialGoalResponse(BaseModel):
    id: int
    name: str
    current_amount: float
    target_amount: float
    color: str
    progress_percentage: float
    created_at: Optional[datetime] = None

