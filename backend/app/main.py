import math
import os
import sys
import requests
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, inspect, text
from sqlalchemy.orm import Session
from dotenv import load_dotenv

from app.database import Base, engine, get_db
from app.models import (
    Account,
    Transaction,
    TransactionType,
    RecurringBill,
    FinancialGoal,
    Caixinha,
    AppSetting,
)
from app.services.billing import BillSnapshot, compute_bill
from app.schemas import (
    AccountResponse,
    AppSettingsResponse,
    AppSettingsUpdate,
    CaixinhaCreate,
    CaixinhaResponse,
    CaixinhaUpdate,
    CardSettings,
    CardSettingsUpdateRequest,
    CategoryExpense,
    DashboardMetricsResponse,
    FinancialGoalCreate,
    FinancialGoalResponse,
    FinancialGoalUpdate,
    FutureCommitmentItem,
    PaginatedTransactionsResponse,
    RecurringBillCreate,
    RecurringBillResponse,
    RecurringBillsSummary,
    RecurringBillUpdate,
    SalaryProjection,
    SalaryUpdateRequest,
    SyncResponse,
    TransactionResponse,
    TransactionUpdateSchema,
)
from app.services.pluggy_client import PluggyClient, PluggyClientError

# Cria as tabelas automaticamente na inicialização
Base.metadata.create_all(bind=engine)
with engine.begin() as conn:
    conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS app_settings ("
            "key VARCHAR(100) PRIMARY KEY, "
            "value TEXT, "
            "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
            ")"
        )
    )


def ensure_new_columns():
    """create_all não altera tabelas existentes: adiciona colunas novas em bancos antigos."""
    wanted = {
        "accounts": {"bill_close_date": "DATE", "bill_due_date": "DATE"},
        "transactions": {
            "bill_id": "VARCHAR(100)",
            "installment_number": "INTEGER",
            "total_installments": "INTEGER",
        },
    }
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in wanted.items():
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


ensure_new_columns()

app = FastAPI(
    title="Personal Finance Manager API",
    description="Backend FastAPI integrado ao Meu Pluggy para controle financeiro pessoal.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "ok"}


def sanitize_financial_ledger(db: Session):
    """
    Higienização contábil contínua:
    1. Pagamentos de fatura de cartão:
       - No banco (DEBIT): 'Pagamento de fatura', 'Pgto fatura', etc.
       - No cartão (CREDIT): 'Pagamento recebido', etc.
       Ambos devem ter is_ignored = 1 e category = 'Pagamento de Fatura',
       pois o gasto real já foi contabilizado compra a compra no cartão.
    2. Movimentações internas de caixinha / reserva:
       - 'Dinheiro reservado...', 'Dinheiro retirado...'
       Devem ter is_ignored = 1 e category = 'Transferência / Reserva'.
    3. Aplicações e Resgates de Investimentos / Poupança:
       - 'Aplicação CDB%', 'Resgate CDB%', 'Aplicação RDB%', 'Resgate RDB%', etc.
       Devem ter is_ignored = 1 e category = 'Investimento / Transferência'.
    """
    try:
        # Faturas
        db.execute(
            text(
                "UPDATE transactions SET is_ignored = 1, category = 'Pagamento de Fatura' "
                "WHERE ("
                "   LOWER(description) LIKE '%pagamento de fatura%' "
                "   OR LOWER(description) LIKE '%pagamento recebido%' "
                "   OR LOWER(description) LIKE '%pgto fatura%' "
                "   OR LOWER(description) LIKE '%pagamento de cartao%' "
                "   OR LOWER(description) LIKE '%pagamento de cartão%' "
                ") AND (is_ignored = 0 OR category != 'Pagamento de Fatura')"
            )
        )
        # Caixinhas / Reservas
        db.execute(
            text(
                "UPDATE transactions SET is_ignored = 1, category = 'Transferência / Reserva' "
                "WHERE ("
                "   LOWER(description) LIKE 'dinheiro reservado%' "
                "   OR LOWER(description) LIKE 'dinheiro retirado%' "
                ") AND (is_ignored = 0 OR category != 'Transferência / Reserva')"
            )
        )
        # Aplicações e Resgates (CDB, RDB, Poupança, Fundos)
        db.execute(
            text(
                "UPDATE transactions SET is_ignored = 1, category = 'Investimento / Transferência' "
                "WHERE ("
                "   LOWER(description) LIKE '%aplicação cdb%' "
                "   OR LOWER(description) LIKE '%resgate cdb%' "
                "   OR LOWER(description) LIKE '%aplicação rdb%' "
                "   OR LOWER(description) LIKE '%resgate rdb%' "
                "   OR LOWER(description) LIKE '%aplicacao cdb%' "
                "   OR LOWER(description) LIKE '%resgate cdb%' "
                "   OR LOWER(description) LIKE '%aplicacao rdb%' "
                "   OR LOWER(description) LIKE '%resgate rdb%' "
                "   OR LOWER(description) LIKE '%aplicação poupança%' "
                "   OR LOWER(description) LIKE '%resgate poupança%' "
                "   OR LOWER(description) LIKE '%aplicacao poupanca%' "
                "   OR LOWER(description) LIKE '%resgate poupanca%' "
                ") AND (is_ignored = 0 OR category != 'Investimento / Transferência')"
            )
        )
        db.commit()
    except Exception:
        db.rollback()


@app.post("/api/v1/sync", response_model=SyncResponse)
def sync_pluggy_data(
    date_from: Optional[str] = Query(
        default=None,
        description="Data inicial opcional no formato YYYY-MM-DD",
    ),
    db: Session = Depends(get_db),
):
    """
    4. Endpoint POST /api/v1/sync:
    Autentica na Pluggy via CLIENT_ID e CLIENT_SECRET, busca contas e transações
    associadas ao PLUGGY_ITEM_ID do .env e executa upsert no banco de dados.
    """
    cid, sec, iid = get_pluggy_credentials(db)
    if not cid or not sec:
        raise HTTPException(
            status_code=400,
            detail="Credenciais da Pluggy não configuradas. Acesse as configurações no topo para conectar seu banco.",
        )
    client = PluggyClient(client_id=cid, client_secret=sec, item_id=iid or None)
    try:
        result = client.sync_to_database(db=db, date_from=date_from)
        sanitize_financial_ledger(db)
        return SyncResponse(
            status="success",
            accounts_synced=result["accounts_synced"],
            transactions_upserted=result["transactions_upserted"],
            message=(
                f"Sincronização concluída: {result['accounts_synced']} conta(s) e "
                f"{result['transactions_upserted']} transação(ões) processadas."
            ),
        )
    except PluggyClientError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Erro interno durante a sincronização: {str(exc)}",
        ) from exc


@app.get("/api/v1/categories")
def get_categories(db: Session = Depends(get_db)):
    """Retorna todas as categorias únicas cadastradas no banco."""
    rows = (
        db.query(Transaction.category)
        .filter(Transaction.category.isnot(None))
        .distinct()
        .order_by(Transaction.category.asc())
        .all()
    )
    categories = [r[0] for r in rows if r[0]]
    defaults = [
        "Alimentação",
        "Assinaturas",
        "Compras",
        "Educação",
        "Lazer",
        "Moradia",
        "Saúde",
        "Serviços",
        "Supermercado",
        "Transporte",
        "Transferências",
        "Outros",
    ]
    all_cats = sorted(list(set(categories + defaults)))
    return {"categories": all_cats}


@app.get("/api/v1/transactions", response_model=PaginatedTransactionsResponse)
def list_transactions(
    page: int = Query(1, ge=1, description="Número da página"),
    page_size: int = Query(20, ge=1, le=100, description="Itens por página"),
    account_id: Optional[int] = Query(None, description="Filtro por conta"),
    period: Optional[str] = Query("current_month", description="Filtro de período: 'current_month', 'future', 'all'"),
    search: Optional[str] = Query(None, description="Busca por descrição ou estabelecimento"),
    start_date: Optional[datetime] = Query(None, description="Filtro data inicial (ISO)"),
    end_date: Optional[datetime] = Query(None, description="Filtro data final (ISO)"),
    category: Optional[str] = Query(None, description="Filtro por categoria"),
    db: Session = Depends(get_db),
):
    """Listagem paginada das transações com filtros avançados."""
    query = db.query(Transaction)

    now = datetime.now(timezone.utc)
    target_year = now.year
    target_month = now.month
    if target_month == 12:
        start_of_next_month = datetime(target_year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        start_of_next_month = datetime(target_year, target_month + 1, 1, tzinfo=timezone.utc)

    # Filtro de período inteligente
    if period == "current_month":
        # Não traz parcelas futuras no extrato principal
        query = query.filter(Transaction.date < start_of_next_month)
    elif period == "future":
        # Apenas parcelas dos próximos meses
        query = query.filter(Transaction.date >= start_of_next_month)

    if isinstance(account_id, int):
        query = query.filter(Transaction.account_id == account_id)

    if isinstance(search, str) and search.strip():
        search_term = f"%{search.strip()}%"
        query = query.filter(
            (Transaction.description.ilike(search_term))
            | (Transaction.merchant_name.ilike(search_term))
        )

    if start_date and isinstance(start_date, datetime):
        query = query.filter(Transaction.date >= start_date)
    if end_date and isinstance(end_date, datetime):
        query = query.filter(Transaction.date <= end_date)
    if category and isinstance(category, str) and category.strip():
        query = query.filter(Transaction.category.ilike(f"%{category}%"))

    total = query.count()
    total_pages = max(1, math.ceil(total / page_size))

    tx_rows = (
        query.order_by(Transaction.date.desc(), Transaction.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items = [
        TransactionResponse(
            id=t.id,
            account_id=t.account_id,
            account_name=t.account.name if t.account else "Conta",
            account_type=t.account.type if t.account else "BANK",
            amount=t.amount,
            date=t.date,
            description=t.description,
            merchant_name=t.merchant_name,
            merchant_cnpj=t.merchant_cnpj,
            category=t.category,
            type=t.type,
            pluggy_transaction_id=t.pluggy_transaction_id,
            is_ignored=bool(t.is_ignored),
        )
        for t in tx_rows
    ]

    return PaginatedTransactionsResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@app.patch("/api/v1/transactions/{transaction_id}", response_model=TransactionResponse)
def update_transaction(
    transaction_id: int,
    payload: TransactionUpdateSchema,
    db: Session = Depends(get_db),
):
    """Atualiza a categoria ou o status de exclusão de uma transação."""
    tx = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transação não encontrada.")

    if payload.category is not None:
        tx.category = payload.category.strip()
    if payload.is_ignored is not None:
        tx.is_ignored = 1 if payload.is_ignored else 0

    db.commit()
    db.refresh(tx)

    return TransactionResponse(
        id=tx.id,
        account_id=tx.account_id,
        account_name=tx.account.name if tx.account else "Conta",
        account_type=tx.account.type if tx.account else "BANK",
        amount=tx.amount,
        date=tx.date,
        description=tx.description,
        merchant_name=tx.merchant_name,
        merchant_cnpj=tx.merchant_cnpj,
        category=tx.category,
        type=tx.type,
        pluggy_transaction_id=tx.pluggy_transaction_id,
        is_ignored=bool(tx.is_ignored),
    )


def load_settings_map(db: Session) -> dict:
    try:
        rows = db.execute(text("SELECT key, value FROM app_settings")).fetchall()
        return {row[0]: row[1] for row in rows}
    except Exception:
        return {}


def _to_float(raw: Optional[str]) -> Optional[float]:
    try:
        return float(raw) if raw not in (None, "") else None
    except ValueError:
        return None


def resolve_card_bill(db: Session, settings_map: dict, now: datetime):
    """
    Calcula a fatura a pagar e aplica o valor manual, se houver.
    Retorna (snapshot, closing_day, due_day, custom_amount ou None).

    Dias de fechamento/vencimento: os informados pelo banco (creditData da Pluggy)
    têm prioridade; os configurados manualmente valem só sem esse dado.
    O valor manual vale apenas para a fatura em que foi salvo (custom_bill_cycle
    = vencimento dela); quando a fatura muda, volta ao cálculo automático.
    """
    credit_accounts = db.query(Account).filter(Account.type == "CREDIT").all()
    closing_day = int(settings_map.get("card_closing_day", 2) or 2)
    due_day = int(settings_map.get("card_due_day", 7) or 7)
    bank_close = next((a.bill_close_date for a in credit_accounts if a.bill_close_date), None)
    bank_due = next((a.bill_due_date for a in credit_accounts if a.bill_due_date), None)
    if bank_close:
        closing_day = bank_close.day
    if bank_due:
        due_day = bank_due.day

    snapshot = compute_bill(
        db, [a.id for a in credit_accounts], closing_day, due_day, now
    )

    custom_amount = _to_float(settings_map.get("custom_bill_amount"))
    if (
        custom_amount is None
        or custom_amount <= 0
        or settings_map.get("custom_bill_cycle") != snapshot.due_date.isoformat()
    ):
        custom_amount = None

    return snapshot, closing_day, due_day, custom_amount


@app.get("/api/v1/metrics", response_model=DashboardMetricsResponse)
def get_dashboard_metrics(
    month: Optional[int] = Query(None, ge=1, le=12, description="Mês de referência (1-12)"),
    year: Optional[int] = Query(None, ge=2000, le=2100, description="Ano de referência"),
    db: Session = Depends(get_db),
):
    """
    Retorna métricas financeiras reais e segregadas:
    - Saldo em contas correntes / poupança (dinheiro disponível)
    - Fatura do cartão de crédito (compromisso / fatura)
    - Patrimônio Líquido Real (Saldo em contas - Cartão)
    - Receitas e Despesas do mês (excluindo transações ignoradas)
    - Compromissos futuros de faturas parceladas
    - Despesas agrupadas por categoria
    - Lista de contas vinculadas
    """
    sanitize_financial_ledger(db)

    now = datetime.now(timezone.utc)
    target_year = year if isinstance(year, int) else now.year
    target_month = month if isinstance(month, int) else now.month

    start_of_month = datetime(target_year, target_month, 1, tzinfo=timezone.utc)
    if target_month == 12:
        start_of_next_month = datetime(target_year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        start_of_next_month = datetime(target_year, target_month + 1, 1, tzinfo=timezone.utc)

    # 1. Saldos segregados por tipo de conta
    bank_balance = (
        db.query(func.coalesce(func.sum(Account.balance), 0))
        .filter(Account.type == "BANK")
        .scalar()
        or 0
    )
    credit_balance = (
        db.query(func.coalesce(func.sum(Account.balance), 0))
        .filter(Account.type == "CREDIT")
        .scalar()
        or 0
    )

    bank_float = float(bank_balance)
    credit_float = float(credit_balance)
    net_balance = bank_float - credit_float
    current_balance = bank_float + credit_float

    # 2. Receitas e Despesas do mês selecionado (excluindo transferências ignoradas)
    monthly_income = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.type == TransactionType.CREDIT,
            Transaction.date >= start_of_month,
            Transaction.date < start_of_next_month,
            Transaction.is_ignored == 0,
        )
        .scalar()
        or 0
    )

    monthly_expenses = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.type == TransactionType.DEBIT,
            Transaction.date >= start_of_month,
            Transaction.date < start_of_next_month,
            Transaction.is_ignored == 0,
        )
        .scalar()
        or 0
    )

    # 3. Despesas por Categoria no mês
    category_rows = (
        db.query(
            func.coalesce(Transaction.category, "Outros").label("category"),
            func.coalesce(func.sum(Transaction.amount), 0).label("total"),
        )
        .filter(
            Transaction.type == TransactionType.DEBIT,
            Transaction.date >= start_of_month,
            Transaction.date < start_of_next_month,
            Transaction.is_ignored == 0,
        )
        .group_by(func.coalesce(Transaction.category, "Outros"))
        .order_by(func.sum(Transaction.amount).desc())
        .all()
    )

    expenses_by_category = [
        CategoryExpense(category=row.category, total=float(row.total))
        for row in category_rows
    ]

    # 4. Faturas / Compromissos futuros (parcelas do cartão com data posterior ao mês atual)
    future_rows = (
        db.query(Transaction)
        .filter(
            Transaction.type == TransactionType.DEBIT,
            Transaction.date >= start_of_next_month,
            Transaction.is_ignored == 0,
        )
        .order_by(Transaction.date.asc())
        .all()
    )

    # Agrupa por mês futuro
    month_names = {
        1: "Janeiro", 2: "Fevereiro", 3: "Março", 4: "Abril",
        5: "Maio", 6: "Junho", 7: "Julho", 8: "Agosto",
        9: "Setembro", 10: "Outubro", 11: "Novembro", 12: "Dezembro"
    }

    future_by_month_dict = {}
    future_commitments_total = 0.0

    for f_tx in future_rows:
        amount_float = float(f_tx.amount)
        future_commitments_total += amount_float
        m_key = f_tx.date.strftime("%Y-%m")
        if m_key not in future_by_month_dict:
            label = f"{month_names.get(f_tx.date.month, '')}/{f_tx.date.year}"
            future_by_month_dict[m_key] = {"month": m_key, "label": label, "total": 0.0, "count": 0}
        future_by_month_dict[m_key]["total"] += amount_float
        future_by_month_dict[m_key]["count"] += 1

    future_commitments = [
        FutureCommitmentItem(
            month=item["month"],
            label=item["label"],
            total=round(item["total"], 2),
            count=item["count"],
        )
        for item in sorted(future_by_month_dict.values(), key=lambda x: x["month"])
    ]

    # 5. Lista de contas cadastradas
    accounts_db = db.query(Account).order_by(Account.id.asc()).all()
    accounts_response = [
        AccountResponse(
            id=acc.id,
            name=acc.name,
            type=acc.type,
            balance=acc.balance,
            currency=acc.currency,
            pluggy_account_id=acc.pluggy_account_id,
        )
        for acc in accounts_db
    ]

    # 6. Configurações de Cartão e Projeção Dinâmica
    settings_map = load_settings_map(db)
    user_salary = float(settings_map.get("user_salary", 0.0) or 0.0)

    bill, card_closing_day, card_due_day, custom_bill_amount = resolve_card_bill(
        db, settings_map, now
    )
    if custom_bill_amount is not None:
        current_bill = custom_bill_amount
        is_bill_custom = True
    else:
        current_bill = bill.amount
        is_bill_custom = False

    # 7. Contas Fixas / Recorrentes
    curr_ym = now.strftime("%Y-%m")
    active_recurring = (
        db.query(RecurringBill).filter(RecurringBill.is_active == 1).all()
    )
    rec_total = sum(float(b.amount) for b in active_recurring)
    rec_paid = sum(
        float(b.amount) for b in active_recurring if b.last_paid_month == curr_ym
    )
    rec_pending = max(0.0, rec_total - rec_paid)

    # 7.1 Caixinhas (Mercado Pago / Reservas)
    caixinhas_liquid_total = (
        db.query(func.coalesce(func.sum(Caixinha.balance), 0))
        .filter(Caixinha.include_in_free_balance == 1)
        .scalar()
        or 0
    )
    caixinhas_total = (
        db.query(func.coalesce(func.sum(Caixinha.balance), 0))
        .scalar()
        or 0
    )
    caixinhas_liquid_float = float(caixinhas_liquid_total)
    caixinhas_total_float = float(caixinhas_total)

    total_commitments = current_bill + rec_pending
    total_available = user_salary + bank_float + caixinhas_liquid_float
    free_balance = total_available - total_commitments
    if total_available > 0:
        commitment_pct = min(
            100.0, max(0.0, (total_commitments / total_available) * 100.0)
        )
    else:
        commitment_pct = 100.0

    days_remaining = max(1, (bill.open_cycle_end.date() - now.date()).days)
    daily_budget = max(0.0, free_balance / float(days_remaining))

    if free_balance <= 0:
        salary_status = "CRITICAL"
    elif commitment_pct >= 70.0:
        salary_status = "WARNING"
    else:
        salary_status = "HEALTHY"

    salary_projection = SalaryProjection(
        salary=round(user_salary, 2),
        bank_balance=round(bank_float, 2),
        credit_balance=round(credit_float, 2),
        current_bill=round(current_bill, 2),
        recurring_bills_total=round(rec_total, 2),
        recurring_bills_pending=round(rec_pending, 2),
        caixinhas_liquid_total=round(caixinhas_liquid_float, 2),
        caixinhas_total=round(caixinhas_total_float, 2),
        is_bill_custom=is_bill_custom,
        bill_closing_day=card_closing_day,
        bill_due_day=card_due_day,
        bill_cycle_start=bill.cycle_start.strftime("%d/%m"),
        # Último dia de compras do ciclo (o fechamento é exclusivo)
        bill_cycle_end=(bill.cycle_end - timedelta(days=1)).strftime("%d/%m"),
        bill_status=bill.status,
        bill_source=bill.source,
        bill_due_date=bill.due_date.strftime("%d/%m"),
        bill_closed_amount=bill.closed_amount,
        bill_open_amount=bill.open_amount,
        total_available=round(total_available, 2),
        free_balance=round(free_balance, 2),
        days_remaining=days_remaining,
        commitment_percentage=round(commitment_pct, 1),
        daily_budget=round(daily_budget, 2),
        status=salary_status,
    )

    return DashboardMetricsResponse(
        bank_balance=round(bank_float, 2),
        credit_balance=round(credit_float, 2),
        net_balance=round(net_balance, 2),
        current_balance=round(current_balance, 2),
        monthly_income=round(float(monthly_income), 2),
        monthly_expenses=round(float(monthly_expenses), 2),
        future_commitments_total=round(future_commitments_total, 2),
        future_commitments=future_commitments,
        expenses_by_category=expenses_by_category,
        accounts=accounts_response,
        salary_projection=salary_projection,
    )


@app.post("/api/v1/settings/salary", response_model=SalaryProjection)
def update_salary(payload: SalaryUpdateRequest, db: Session = Depends(get_db)):
    """Salva o salário mensal do usuário e recalcula as projeções."""
    new_salary = max(0.0, float(payload.salary))
    try:
        db.execute(
            text(
                "INSERT INTO app_settings (key, value) VALUES ('user_salary', :val) "
                "ON CONFLICT(key) DO UPDATE SET value = :val"
            ),
            {"val": str(new_salary)},
        )
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao salvar salário: {str(e)}")

    metrics = get_dashboard_metrics(db=db)
    return metrics.salary_projection


@app.get("/api/v1/settings/card", response_model=CardSettings)
def get_card_settings(db: Session = Depends(get_db)):
    """Retorna as configurações do cartão (dia de fechamento, vencimento e fatura customizada)."""
    settings_map = load_settings_map(db)
    _, closing_day, due_day, custom_bill = resolve_card_bill(
        db, settings_map, datetime.now(timezone.utc)
    )
    return CardSettings(
        closing_day=closing_day,
        due_day=due_day,
        custom_bill_amount=custom_bill,
    )


@app.post("/api/v1/settings/card", response_model=SalaryProjection)
def update_card_settings(payload: CardSettingsUpdateRequest, db: Session = Depends(get_db)):
    """Atualiza as configurações do ciclo do cartão e recalcula a projeção."""
    try:
        if payload.closing_day is not None:
            c_day = max(1, min(31, payload.closing_day))
            db.execute(
                text(
                    "INSERT INTO app_settings (key, value) VALUES ('card_closing_day', :val) "
                    "ON CONFLICT(key) DO UPDATE SET value = :val"
                ),
                {"val": str(c_day)},
            )
        if payload.due_day is not None:
            d_day = max(1, min(31, payload.due_day))
            db.execute(
                text(
                    "INSERT INTO app_settings (key, value) VALUES ('card_due_day', :val) "
                    "ON CONFLICT(key) DO UPDATE SET value = :val"
                ),
                {"val": str(d_day)},
            )
        if payload.use_auto_bill:
            db.execute(
                text(
                    "INSERT INTO app_settings (key, value) VALUES ('custom_bill_amount', '') "
                    "ON CONFLICT(key) DO UPDATE SET value = ''"
                )
            )
        elif payload.custom_bill_amount is not None:
            c_amount = max(0.0, float(payload.custom_bill_amount))
            # Amarra o valor manual à fatura atual (calculada já com os dias salvos acima)
            bill, _, _, _ = resolve_card_bill(
                db, load_settings_map(db), datetime.now(timezone.utc)
            )
            for key, val in (
                ("custom_bill_amount", str(c_amount)),
                ("custom_bill_cycle", bill.due_date.isoformat()),
            ):
                db.execute(
                    text(
                        "INSERT INTO app_settings (key, value) VALUES (:key, :val) "
                        "ON CONFLICT(key) DO UPDATE SET value = :val"
                    ),
                    {"key": key, "val": val},
                )
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao salvar configurações do cartão: {str(e)}")

    metrics = get_dashboard_metrics(db=db)
    return metrics.salary_projection


@app.get("/api/v1/recurring-bills", response_model=RecurringBillsSummary)
def list_recurring_bills(db: Session = Depends(get_db)):
    """Lista todas as contas fixas/recorrentes e resume totais pagos/pendentes no mês atual."""
    now = datetime.now(timezone.utc)
    curr_ym = now.strftime("%Y-%m")

    bills = (
        db.query(RecurringBill)
        .order_by(RecurringBill.due_day.asc(), RecurringBill.id.asc())
        .all()
    )

    items = [
        RecurringBillResponse(
            id=b.id,
            name=b.name,
            amount=float(b.amount),
            due_day=b.due_day,
            category=b.category,
            is_active=bool(b.is_active),
            is_paid_this_month=(b.last_paid_month == curr_ym),
            created_at=b.created_at,
        )
        for b in bills
    ]

    total_monthly = sum(b.amount for b in items if b.is_active)
    total_paid = sum(
        b.amount for b in items if b.is_active and b.is_paid_this_month
    )
    total_pending = max(0.0, total_monthly - total_paid)

    return RecurringBillsSummary(
        total_monthly=round(total_monthly, 2),
        total_paid=round(total_paid, 2),
        total_pending=round(total_pending, 2),
        items=items,
    )


@app.post("/api/v1/recurring-bills", response_model=RecurringBillResponse)
def create_recurring_bill(
    payload: RecurringBillCreate, db: Session = Depends(get_db)
):
    """Cria uma nova conta fixa/recorrente."""
    new_bill = RecurringBill(
        name=payload.name.strip(),
        amount=max(0.0, float(payload.amount)),
        due_day=max(1, min(31, payload.due_day)),
        category=payload.category.strip() or "Outros",
        is_active=1,
        last_paid_month=None,
    )
    db.add(new_bill)
    db.commit()
    db.refresh(new_bill)

    return RecurringBillResponse(
        id=new_bill.id,
        name=new_bill.name,
        amount=float(new_bill.amount),
        due_day=new_bill.due_day,
        category=new_bill.category,
        is_active=bool(new_bill.is_active),
        is_paid_this_month=False,
        created_at=new_bill.created_at,
    )


@app.patch(
    "/api/v1/recurring-bills/{bill_id}", response_model=RecurringBillResponse
)
def update_recurring_bill(
    bill_id: int, payload: RecurringBillUpdate, db: Session = Depends(get_db)
):
    """Atualiza uma conta fixa existente."""
    now = datetime.now(timezone.utc)
    curr_ym = now.strftime("%Y-%m")
    bill = db.query(RecurringBill).filter(RecurringBill.id == bill_id).first()
    if not bill:
        raise HTTPException(
            status_code=404, detail="Conta fixa não encontrada."
        )

    if payload.name is not None and payload.name.strip():
        bill.name = payload.name.strip()
    if payload.amount is not None:
        bill.amount = max(0.0, float(payload.amount))
    if payload.due_day is not None:
        bill.due_day = max(1, min(31, payload.due_day))
    if payload.category is not None and payload.category.strip():
        bill.category = payload.category.strip()
    if payload.is_active is not None:
        bill.is_active = 1 if payload.is_active else 0

    db.commit()
    db.refresh(bill)

    return RecurringBillResponse(
        id=bill.id,
        name=bill.name,
        amount=float(bill.amount),
        due_day=bill.due_day,
        category=bill.category,
        is_active=bool(bill.is_active),
        is_paid_this_month=(bill.last_paid_month == curr_ym),
        created_at=bill.created_at,
    )


@app.delete("/api/v1/recurring-bills/{bill_id}")
def delete_recurring_bill(bill_id: int, db: Session = Depends(get_db)):
    """Exclui uma conta fixa."""
    bill = db.query(RecurringBill).filter(RecurringBill.id == bill_id).first()
    if not bill:
        raise HTTPException(
            status_code=404, detail="Conta fixa não encontrada."
        )
    db.delete(bill)
    db.commit()
    return {"status": "success", "message": "Conta fixa excluída com sucesso."}


@app.post(
    "/api/v1/recurring-bills/{bill_id}/toggle-paid",
    response_model=RecurringBillResponse,
)
def toggle_recurring_bill_paid(bill_id: int, db: Session = Depends(get_db)):
    """Alterna o status de pago no mês atual."""
    now = datetime.now(timezone.utc)
    curr_ym = now.strftime("%Y-%m")
    bill = db.query(RecurringBill).filter(RecurringBill.id == bill_id).first()
    if not bill:
        raise HTTPException(
            status_code=404, detail="Conta fixa não encontrada."
        )

    if bill.last_paid_month == curr_ym:
        bill.last_paid_month = None
    else:
        bill.last_paid_month = curr_ym

    db.commit()
    db.refresh(bill)

    return RecurringBillResponse(
        id=bill.id,
        name=bill.name,
        amount=float(bill.amount),
        due_day=bill.due_day,
        category=bill.category,
        is_active=bool(bill.is_active),
        is_paid_this_month=(bill.last_paid_month == curr_ym),
        created_at=bill.created_at,
    )


def _format_goal(g: FinancialGoal) -> FinancialGoalResponse:
    curr = float(g.current_amount or 0.0)
    targ = max(1.0, float(g.target_amount or 1.0))
    pct = min(100.0, round((curr / targ) * 100.0, 1))
    return FinancialGoalResponse(
        id=g.id,
        name=g.name,
        current_amount=round(curr, 2),
        target_amount=round(targ, 2),
        color=g.color or "emerald",
        progress_percentage=pct,
        created_at=g.created_at,
    )


@app.get("/api/v1/goals", response_model= list[FinancialGoalResponse])
def list_financial_goals(db: Session = Depends(get_db)):
    """Lista todas as metas financeiras e só cria exemplos na primeiríssima execução."""
    try:
        seeded = db.execute(
            text("SELECT value FROM app_settings WHERE key = 'goals_initialized'")
        ).first()
    except Exception:
        seeded = None

    if not seeded:
        try:
            db.execute(
                text(
                    "INSERT INTO app_settings (key, value) VALUES ('goals_initialized', '1') "
                    "ON CONFLICT(key) DO NOTHING"
                )
            )
            db.commit()
        except Exception:
            db.rollback()

    goals = db.query(FinancialGoal).order_by(FinancialGoal.id.asc()).all()
    return [_format_goal(g) for g in goals]


@app.post("/api/v1/goals", response_model=FinancialGoalResponse)
def create_financial_goal(payload: FinancialGoalCreate, db: Session = Depends(get_db)):
    """Cria uma nova meta financeira."""
    new_goal = FinancialGoal(
        name=payload.name.strip(),
        current_amount=max(0.0, float(payload.current_amount)),
        target_amount=max(1.0, float(payload.target_amount)),
        color=payload.color or "emerald",
    )
    db.add(new_goal)
    db.commit()
    db.refresh(new_goal)
    return _format_goal(new_goal)


@app.patch("/api/v1/goals/{goal_id}", response_model=FinancialGoalResponse)
def update_financial_goal(
    goal_id: int, payload: FinancialGoalUpdate, db: Session = Depends(get_db)
):
    """Atualiza uma meta financeira existente."""
    goal = db.query(FinancialGoal).filter(FinancialGoal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Meta não encontrada.")

    if payload.name is not None and payload.name.strip():
        goal.name = payload.name.strip()
    if payload.current_amount is not None:
        goal.current_amount = max(0.0, float(payload.current_amount))
    if payload.target_amount is not None:
        goal.target_amount = max(1.0, float(payload.target_amount))
    if payload.color is not None:
        goal.color = payload.color

    db.commit()
    db.refresh(goal)
    return _format_goal(goal)


@app.delete("/api/v1/goals/{goal_id}")
def delete_financial_goal(goal_id: int, db: Session = Depends(get_db)):
    """Exclui uma meta financeira."""
    goal = db.query(FinancialGoal).filter(FinancialGoal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Meta não encontrada.")
    db.delete(goal)
    db.commit()
    return {"status": "success", "message": "Meta excluída com sucesso."}


# ==============================================================================
# CAIXINHAS / RESERVAS MERCADO PAGO
# ==============================================================================

def _format_caixinha(c: Caixinha, goal_name: Optional[str] = None) -> CaixinhaResponse:
    return CaixinhaResponse(
        id=c.id,
        name=c.name,
        balance=float(c.balance or 0.0),
        include_in_free_balance=bool(c.include_in_free_balance),
        linked_goal_id=c.linked_goal_id,
        linked_goal_name=goal_name,
        updated_at=c.updated_at,
    )


def sanitize_reserve_transactions(db: Session):
    """Alias para sanitize_financial_ledger."""
    sanitize_financial_ledger(db)


@app.get("/api/v1/caixinhas", response_model=list[CaixinhaResponse])
def list_caixinhas(db: Session = Depends(get_db)):
    """Lista todas as caixinhas/reservas. Detecta do extrato se tabela estiver vazia."""
    sanitize_financial_ledger(db)

    items = db.query(Caixinha).order_by(Caixinha.id.asc()).all()
    if not items:
        # Detecta nomes existentes no histórico
        raw_names = db.execute(
            text(
                "SELECT DISTINCT SUBSTR(description, 20) FROM transactions "
                "WHERE description LIKE 'Dinheiro reservado %' "
                "UNION "
                "SELECT DISTINCT SUBSTR(description, 19) FROM transactions "
                "WHERE description LIKE 'Dinheiro retirado %'"
            )
        ).fetchall()
        detected_names = [r[0].strip() for r in raw_names if r[0] and r[0].strip()]

        if detected_names:
            for name in detected_names:
                cx = Caixinha(
                    name=name,
                    balance=0.0,
                    include_in_free_balance=0,
                    linked_goal_id=None,
                )
                db.add(cx)
            db.commit()
            items = db.query(Caixinha).order_by(Caixinha.id.asc()).all()

    goals = {g.id: g.name for g in db.query(FinancialGoal).all()}
    return [_format_caixinha(c, goals.get(c.linked_goal_id)) for c in items]


@app.post("/api/v1/caixinhas", response_model=CaixinhaResponse)
def create_caixinha(payload: CaixinhaCreate, db: Session = Depends(get_db)):
    """Cria uma nova caixinha manualmente."""
    name_clean = payload.name.strip()
    existing = db.query(Caixinha).filter(Caixinha.name == name_clean).first()
    if existing:
        raise HTTPException(status_code=400, detail="Já existe uma caixinha com esse nome.")

    new_cx = Caixinha(
        name=name_clean,
        balance=max(0.0, float(payload.balance)),
        include_in_free_balance=1 if payload.include_in_free_balance else 0,
        linked_goal_id=payload.linked_goal_id if payload.linked_goal_id and payload.linked_goal_id > 0 else None,
    )
    db.add(new_cx)
    db.commit()
    db.refresh(new_cx)

    if new_cx.linked_goal_id:
        goal = db.query(FinancialGoal).filter(FinancialGoal.id == new_cx.linked_goal_id).first()
        if goal:
            goal.current_amount = new_cx.balance
            db.commit()

    goal_name = db.query(FinancialGoal.name).filter(FinancialGoal.id == new_cx.linked_goal_id).scalar() if new_cx.linked_goal_id else None
    return _format_caixinha(new_cx, goal_name)


@app.patch("/api/v1/caixinhas/{caixinha_id}", response_model=CaixinhaResponse)
def update_caixinha(caixinha_id: int, payload: CaixinhaUpdate, db: Session = Depends(get_db)):
    """Atualiza saldo, inclusão no saldo livre (CDI) ou vínculo com meta."""
    cx = db.query(Caixinha).filter(Caixinha.id == caixinha_id).first()
    if not cx:
        raise HTTPException(status_code=404, detail="Caixinha não encontrada.")

    if payload.balance is not None:
        cx.balance = max(0.0, float(payload.balance))
    if payload.include_in_free_balance is not None:
        cx.include_in_free_balance = 1 if payload.include_in_free_balance else 0
    if payload.linked_goal_id is not None:
        cx.linked_goal_id = payload.linked_goal_id if payload.linked_goal_id > 0 else None

    db.commit()
    db.refresh(cx)

    # Sincroniza meta vinculada
    if cx.linked_goal_id:
        goal = db.query(FinancialGoal).filter(FinancialGoal.id == cx.linked_goal_id).first()
        if goal:
            goal.current_amount = cx.balance
            db.commit()

    goal_name = db.query(FinancialGoal.name).filter(FinancialGoal.id == cx.linked_goal_id).scalar() if cx.linked_goal_id else None
    return _format_caixinha(cx, goal_name)


@app.delete("/api/v1/caixinhas/{caixinha_id}")
def delete_caixinha(caixinha_id: int, db: Session = Depends(get_db)):
    """Exclui uma caixinha."""
    cx = db.query(Caixinha).filter(Caixinha.id == caixinha_id).first()
    if not cx:
        raise HTTPException(status_code=404, detail="Caixinha não encontrada.")
    db.delete(cx)
    db.commit()
    return {"status": "success", "message": "Caixinha excluída com sucesso."}


def get_pluggy_credentials(db: Session) -> tuple[str, str, str]:
    """Recupera client_id, client_secret e item_id do banco ou das variáveis de ambiente."""
    cid = os.getenv("PLUGGY_CLIENT_ID", "").strip()
    sec = os.getenv("PLUGGY_CLIENT_SECRET", "").strip()
    iid = os.getenv("PLUGGY_ITEM_ID", "").strip()

    try:
        rows = db.execute(
            text(
                "SELECT key, value FROM app_settings "
                "WHERE key IN ('pluggy_client_id', 'pluggy_client_secret', 'pluggy_item_id')"
            )
        ).fetchall()
        db_map = {r[0]: r[1] for r in rows}
        if not cid and db_map.get("pluggy_client_id"):
            cid = db_map["pluggy_client_id"].strip()
        if not sec and db_map.get("pluggy_client_secret"):
            sec = db_map["pluggy_client_secret"].strip()
        if not iid and db_map.get("pluggy_item_id"):
            iid = db_map["pluggy_item_id"].strip()
    except Exception:
        pass

    return cid, sec, iid


@app.get("/api/v1/settings", response_model=AppSettingsResponse)
def get_app_settings(db: Session = Depends(get_db)):
    """Retorna as configurações do aplicativo (nome do usuário e status da Pluggy)."""
    try:
        rows = db.execute(text("SELECT key, value FROM app_settings")).fetchall()
        settings_map = {r[0]: r[1] for r in rows}
    except Exception:
        settings_map = {}

    cid, sec, iid = get_pluggy_credentials(db)
    user_salary = float(settings_map.get("user_salary", 0.0) or 0.0)
    user_name = settings_map.get("user_name", "")

    return AppSettingsResponse(
        user_name=user_name,
        user_salary=user_salary,
        pluggy_configured=bool(cid and sec),
        pluggy_client_id=cid[:8] + "..." if cid else "",
        pluggy_item_id=iid or None,
    )


@app.post("/api/v1/settings")
def update_app_settings(payload: AppSettingsUpdate, db: Session = Depends(get_db)):
    """Atualiza as configurações do aplicativo (nome do usuário, credenciais da Pluggy)."""
    if payload.user_name is not None:
        name_clean = payload.user_name.strip()
        db.execute(
            text(
                "INSERT INTO app_settings (key, value) VALUES ('user_name', :val) "
                "ON CONFLICT(key) DO UPDATE SET value = :val"
            ),
            {"val": name_clean},
        )

    if payload.pluggy_client_id is not None:
        cid_clean = payload.pluggy_client_id.strip()
        db.execute(
            text(
                "INSERT INTO app_settings (key, value) VALUES ('pluggy_client_id', :val) "
                "ON CONFLICT(key) DO UPDATE SET value = :val"
            ),
            {"val": cid_clean},
        )
        os.environ["PLUGGY_CLIENT_ID"] = cid_clean

    if payload.pluggy_client_secret is not None:
        sec_clean = payload.pluggy_client_secret.strip()
        db.execute(
            text(
                "INSERT INTO app_settings (key, value) VALUES ('pluggy_client_secret', :val) "
                "ON CONFLICT(key) DO UPDATE SET value = :val"
            ),
            {"val": sec_clean},
        )
        os.environ["PLUGGY_CLIENT_SECRET"] = sec_clean

    db.commit()
    return {"status": "success", "message": "Configurações salvas com sucesso."}


@app.get("/connect", response_class=HTMLResponse)
def get_connect_page(db: Session = Depends(get_db)):
    """Gera o Connect Token e exibe o widget oficial da Pluggy ou formulário de configuração."""
    client_id, client_secret, _ = get_pluggy_credentials(db)

    if not client_id or not client_secret:
        return HTMLResponse(
            """<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Configurar Open Finance - Nexo</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen flex items-center justify-center p-4 font-sans">
  <div class="max-w-md w-full bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-8 space-y-6">
    <div class="text-center space-y-2">
      <div class="h-12 w-12 rounded-2xl bg-indigo-500/20 text-indigo-400 mx-auto flex items-center justify-center text-2xl font-bold">
        🔌
      </div>
      <h1 class="text-xl font-extrabold text-white">Conectar Open Finance</h1>
      <p class="text-xs text-slate-400">
        Insira suas credenciais da API Pluggy para conectar sua conta bancária oficial.
      </p>
    </div>

    <form id="pluggy-form" class="space-y-4">
      <div class="space-y-1">
        <label class="text-xs font-bold text-slate-300">Client ID da Pluggy:</label>
        <input type="text" id="client_id" required placeholder="Cole seu Client ID aqui"
               class="w-full px-3 py-2 text-xs rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-indigo-500 font-mono">
      </div>
      <div class="space-y-1">
        <label class="text-xs font-bold text-slate-300">Client Secret da Pluggy:</label>
        <input type="password" id="client_secret" required placeholder="Cole seu Client Secret aqui"
               class="w-full px-3 py-2 text-xs rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:outline-indigo-500 font-mono">
      </div>
      <div class="text-[11px] text-slate-400 bg-slate-900/60 p-3 rounded-xl border border-slate-700/60 leading-relaxed">
        💡 Ainda não tem as chaves? Crie sua conta grátis em <a href="https://dashboard.pluggy.ai" target="_blank" class="text-indigo-400 font-bold underline">dashboard.pluggy.ai</a> e copie na aba "API Credentials".
      </div>
      <button type="submit" id="btn-submit"
              class="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition">
        Salvar e Abrir Conexão
      </button>
      <div id="status-msg" class="text-xs text-center font-medium hidden"></div>
    </form>
  </div>

  <script>
    document.getElementById('pluggy-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-submit');
      const status = document.getElementById('status-msg');
      btn.disabled = true;
      btn.innerText = 'Salvando e autenticando...';
      status.className = 'text-xs text-center font-medium hidden';

      const cid = document.getElementById('client_id').value.trim();
      const sec = document.getElementById('client_secret').value.trim();

      try {
        const res = await fetch('/api/v1/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pluggy_client_id: cid, pluggy_client_secret: sec }),
        });
        if (!res.ok) throw new Error('Falha ao salvar credenciais.');
        window.location.reload();
      } catch (err) {
        btn.disabled = false;
        btn.innerText = 'Salvar e Abrir Conexão';
        status.className = 'text-xs text-center font-medium text-rose-400 block';
        status.innerText = err.message || 'Erro ao conectar.';
      }
    });
  </script>
</body>
</html>
""",
            status_code=200,
        )

    # 1. Autenticação na Pluggy
    auth_resp = requests.post(
        "https://api.pluggy.ai/auth",
        json={"clientId": client_id, "clientSecret": client_secret},
        timeout=15,
    )
    if auth_resp.status_code != 200:
        return HTMLResponse(
            f"<h2>Erro ao autenticar na Pluggy ({auth_resp.status_code}): {auth_resp.text}</h2>",
            status_code=500,
        )

    api_key = auth_resp.json().get("apiKey")
    # 2. Gera Connect Token
    token_resp = requests.post(
        "https://api.pluggy.ai/connect_token",
        headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
        json={},
        timeout=15,
    )
    if token_resp.status_code != 200:
        return HTMLResponse(
            f"<h2>Erro ao gerar Connect Token: {token_resp.text}</h2>",
            status_code=500,
        )

    connect_token = token_resp.json().get("accessToken")

    html_content = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Conectar Banco - Pluggy Open Finance</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.pluggy.ai/pluggy-connect/v2.5.0/pluggy-connect.js"></script>
</head>
<body class="bg-slate-900 text-slate-100 flex flex-col items-center justify-center min-h-screen p-4">
  <div class="max-w-md w-full bg-slate-800 rounded-2xl shadow-2xl p-8 border border-slate-700 text-center">
    <div class="w-16 h-16 bg-indigo-600/20 text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-4">
      <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
      </svg>
    </div>
    
    <h1 class="text-2xl font-bold mb-2">Conectar Conta Bancária</h1>
    <p class="text-slate-400 text-sm mb-6">
      Clique no botão abaixo para abrir o widget oficial e conectar seu banco com segurança via Open Finance.
    </p>

    <button id="open-btn" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-6 rounded-xl transition duration-200 shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2">
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
      </svg>
      Abrir Conector Pluggy
    </button>

    <div id="status-card" class="hidden mt-6 p-4 rounded-xl text-sm font-medium"></div>

    <a id="dashboard-link" href="http://localhost:3000" class="hidden mt-4 inline-block w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-6 rounded-xl transition duration-200 text-center">
      Ir para o Dashboard ➔
    </a>
  </div>

  <script>
    const connectToken = "{connect_token}";
    const btn = document.getElementById('open-btn');
    const statusCard = document.getElementById('status-card');
    const dashLink = document.getElementById('dashboard-link');

    function openPluggyWidget() {{
      const pluggyConnect = new PluggyConnect({{
        connectToken: connectToken,
        includeSandbox: true,
        onSuccess: async (data) => {{
          const itemId = data?.item?.id;
          statusCard.className = "mt-6 p-4 rounded-xl text-sm font-medium bg-emerald-950/50 border border-emerald-500 text-emerald-300 block";
          statusCard.innerHTML = "✅ <b>Banco conectado com sucesso!</b><br>Salvando Item ID e sincronizando transações...";
          
          try {{
            const res = await fetch('/api/v1/connect/save', {{
              method: 'POST',
              headers: {{ 'Content-Type': 'application/json' }},
              body: JSON.stringify({{ item_id: itemId }})
            }});
            const json = await res.json();
            statusCard.innerHTML = "🎉 <b>Concluído!</b> " + json.message;
            dashLink.classList.remove('hidden');
          }} catch (e) {{
            statusCard.innerHTML = "Conectado! Item ID: <code>" + itemId + "</code>.<br>Cole no seu .env se necessário.";
            dashLink.classList.remove('hidden');
          }}
        }},
        onError: (err) => {{
          statusCard.className = "mt-6 p-4 rounded-xl text-sm font-medium bg-rose-950/50 border border-rose-500 text-rose-300 block";
          statusCard.innerText = "Erro durante a conexão: " + (err.message || JSON.stringify(err));
        }},
        onClose: () => {{
          console.log("Pluggy Connect fechado pelo usuário.");
        }}
      }});

      pluggyConnect.init();
    }}

    btn.addEventListener('click', openPluggyWidget);
    // Abre automaticamente ao carregar
    window.addEventListener('load', () => {{
      setTimeout(openPluggyWidget, 400);
    }});
  </script>
</body>
</html>
"""
    return HTMLResponse(content=html_content)


@app.post("/api/v1/connect/save")
def save_connected_item(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """Recebe o Item ID da conexão bem-sucedida, atualiza o .env e dispara sincronização imediata."""
    new_item_id = payload.get("item_id")
    if not new_item_id:
        raise HTTPException(status_code=400, detail="item_id não informado.")

    # Atualiza o arquivo .env
    root_env = Path(__file__).resolve().parents[2] / ".env"
    if root_env.exists():
        content = root_env.read_text(encoding="utf-8")
        lines = content.splitlines()
        new_lines = []
        found = False
        for line in lines:
            if line.startswith("PLUGGY_ITEM_ID="):
                new_lines.append(f"PLUGGY_ITEM_ID={new_item_id}")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"PLUGGY_ITEM_ID={new_item_id}")
        root_env.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

    # Salva no banco app_settings para persistência sem depender de .env
    db.execute(
        text(
            "INSERT INTO app_settings (key, value) VALUES ('pluggy_item_id', :val) "
            "ON CONFLICT(key) DO UPDATE SET value = :val"
        ),
        {"val": new_item_id},
    )
    db.commit()

    # Dispara a sincronização imediatamente
    try:
        cid, sec, _ = get_pluggy_credentials(db)
        client = PluggyClient(client_id=cid, client_secret=sec, item_id=new_item_id)
        result = client.sync_to_database(db=db)
        return {
            "status": "success",
            "message": f"Sincronização concluída: {result['accounts_synced']} conta(s) e {result['transactions_upserted']} transação(ões) importadas!",
            "item_id": new_item_id,
        }
    except Exception as exc:
        return {
            "status": "partial",
            "message": f"Item salvo ({new_item_id}), mas a sincronização inicial retornou: {str(exc)}",
            "item_id": new_item_id,
        }


# =============================================================================
# SERVIR O FRONTEND ESTÁTICO (QUANDO EMBUTIDO OU APÓS "npm run build")
# =============================================================================
if getattr(sys, "frozen", False):
    FRONTEND_DIST = os.path.join(sys._MEIPASS, "frontend_out")
else:
    FRONTEND_DIST = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "out")
    )

if os.path.isdir(FRONTEND_DIST):
    next_assets = os.path.join(FRONTEND_DIST, "_next")
    if os.path.isdir(next_assets):
        app.mount("/_next", StaticFiles(directory=next_assets), name="next_assets")

    @app.get("/", response_class=FileResponse)
    async def serve_index():
        index_file = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.isfile(index_file):
            return FileResponse(
                index_file,
                headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"},
            )
        return HTMLResponse("<h1>Frontend build not found</h1>", status_code=404)

    @app.get("/{full_path:path}")
    async def serve_static_fallback(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("connect") or full_path == "docs" or full_path == "openapi.json":
            raise HTTPException(status_code=404, detail="Endpoint não encontrado")
        candidate = os.path.join(FRONTEND_DIST, full_path)
        if os.path.isfile(candidate):
            # Arquivos estáticos em _next podem ser cacheados com segurança
            return FileResponse(candidate)

        # Se for uma extensão de asset ou rota de asset, NUNCA retorne index.html (evita erro de MIME type no CSS/JS)
        asset_extensions = (".css", ".js", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".map", ".json")
        if full_path.startswith("_next/") or full_path.startswith("static/") or any(full_path.endswith(ext) for ext in asset_extensions):
            raise HTTPException(status_code=404, detail="Arquivo não encontrado")

        index_file = os.path.join(FRONTEND_DIST, "index.html")
        if os.path.isfile(index_file):
            return FileResponse(
                index_file,
                headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache"},
            )
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")

