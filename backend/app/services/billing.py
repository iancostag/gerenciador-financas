"""
Cálculo da fatura do cartão de crédito.

Regras:
- O ciclo é calculado no horário de Brasília (UTC-3, sem horário de verão).
  A Pluggy grava parcelas às 03:00Z (meia-noite em Brasília). Usar UTC jogava
  as parcelas do dia de fechamento na fatura errada.
- Ciclos são intervalos semiabertos [fechamento anterior, próximo fechamento):
  a compra feita no dia do fechamento já entra na fatura seguinte e nenhuma
  transação é contada em duas faturas.
- Fatura a pagar = fatura fechada enquanto não for quitada; depois de paga,
  passa a ser a fatura aberta.
- Se a Pluggy enviou a fatura fechada via GET /bills, o valor dela tem prioridade
  sobre a soma das transações.
- Parcelas futuras projetadas pelo banco (com data posterior ao dia de hoje)
  não entram na fatura aberta atual; são computadas como compromissos futuros.
"""
import calendar
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy import func, or_, and_
from sqlalchemy.orm import Session

from app.models import CreditCardBill, Transaction, TransactionType

BRT = timezone(timedelta(hours=-3))
BILL_PAYMENT_CATEGORY = "Pagamento de Fatura"
PAID_TOLERANCE = 1.0


@dataclass
class BillSnapshot:
    amount: float
    status: str  # "CLOSED" (fechada, aguardando pagamento) ou "OPEN" (aberta)
    source: str  # "PLUGGY" (GET /bills) ou "CALCULATED" (soma das transações)
    cycle_start: datetime  # BRT, inclusivo
    cycle_end: datetime  # BRT, exclusivo (dia do fechamento)
    due_date: date
    closed_amount: float
    open_amount: float
    payments: float
    open_cycle_end: datetime  # BRT, próximo fechamento (para o orçamento diário)
    open_due_date: Optional[date] = None


def _closing_at(year: int, month: int, closing_day: int) -> datetime:
    last_day = calendar.monthrange(year, month)[1]
    return datetime(year, month, min(closing_day, last_day), tzinfo=BRT)


def _shift_month(year: int, month: int, delta: int) -> Tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def bill_cycle(closing_day: int, ref: datetime) -> Tuple[datetime, datetime]:
    """Retorna (último fechamento, próximo fechamento) em BRT para o ciclo aberto em `ref`."""
    local = ref.astimezone(BRT) if ref.tzinfo else ref.replace(tzinfo=timezone.utc).astimezone(BRT)
    this_month = _closing_at(local.year, local.month, closing_day)
    if local >= this_month:
        y, m = _shift_month(local.year, local.month, 1)
        return this_month, _closing_at(y, m, closing_day)
    y, m = _shift_month(local.year, local.month, -1)
    return _closing_at(y, m, closing_day), this_month


def due_date_after(closing: datetime, due_day: int) -> date:
    """Primeiro dia `due_day` estritamente depois do fechamento."""
    y, m = closing.year, closing.month
    if due_day <= closing.day:
        y, m = _shift_month(y, m, 1)
    last_day = calendar.monthrange(y, m)[1]
    return date(y, m, min(due_day, last_day))


def _utc(dt: datetime) -> datetime:
    # SQLite grava o datetime sem offset; os filtros precisam estar no mesmo fuso (UTC)
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc)


def _cycle_net(
    db: Session,
    account_ids: List[int],
    start: datetime,
    end: datetime,
    forecast_month: Optional[str] = None,
) -> float:
    def total(tx_type: TransactionType, *extra) -> float:
        query = db.query(func.coalesce(func.sum(Transaction.amount), 0)).filter(
            Transaction.account_id.in_(account_ids),
            Transaction.type == tx_type,
            Transaction.is_ignored == 0,
            *extra,
        )
        if forecast_month:
            # Compatibilidade universal:
            # 1. Se a compra tem bill_forecast_date informado pelo banco (Open Finance),
            #    pertence à fatura oficial prevista pelo emissor do cartão.
            # 2. Se bill_forecast_date for nulo (compras avulsas ou outros bancos),
            #    usa a janela cronológica do ciclo [start, end).
            query = query.filter(
                or_(
                    Transaction.bill_forecast_date == forecast_month,
                    and_(
                        Transaction.bill_forecast_date.is_(None),
                        Transaction.date >= _utc(start),
                        Transaction.date < _utc(end),
                    ),
                )
            )
        else:
            query = query.filter(
                Transaction.date >= _utc(start),
                Transaction.date < _utc(end),
            )
        value = query.scalar()
        return float(value or 0)

    debits = total(TransactionType.DEBIT)
    # Estornos e créditos de lojistas reduzem a fatura;
    # Pagamentos da fatura e créditos internos de rolagem/atraso não abatem compras
    credits = total(
        TransactionType.CREDIT,
        func.coalesce(Transaction.category, "") != BILL_PAYMENT_CATEGORY,
        ~Transaction.description.ilike("%pagamento%"),
        ~Transaction.description.ilike("%atraso%"),
        ~Transaction.description.ilike("%dívida%"),
        ~Transaction.description.ilike("%divida%"),
        ~Transaction.description.ilike("%rotativo%"),
    )
    return debits - credits


def _payments_since(db: Session, account_ids: List[int], since: datetime) -> float:
    value = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(
            Transaction.account_id.in_(account_ids),
            Transaction.type == TransactionType.CREDIT,
            Transaction.date >= _utc(since),
            (
                (Transaction.category == BILL_PAYMENT_CATEGORY)
                | (Transaction.description.ilike("%pagamento recebido%"))
                | (Transaction.description.ilike("%pagamento de fatura%"))
                | (Transaction.description.ilike("%pgto fatura%"))
            ),
        )
        .scalar()
    )
    return float(value or 0)


def compute_bill(
    db: Session,
    account_ids: List[int],
    closing_day: int,
    due_day: int,
    now: Optional[datetime] = None,
) -> BillSnapshot:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now_brt = now.astimezone(BRT)

    last_closing, next_closing = bill_cycle(closing_day, now)
    prev_closing, _ = bill_cycle(closing_day, last_closing - timedelta(seconds=1))
    closed_due = due_date_after(last_closing, due_day)
    open_due = due_date_after(next_closing, due_day)

    if not account_ids:
        return BillSnapshot(
            amount=0.0,
            status="OPEN",
            source="CALCULATED",
            cycle_start=last_closing,
            cycle_end=next_closing,
            due_date=open_due,
            closed_amount=0.0,
            open_amount=0.0,
            payments=0.0,
            open_cycle_end=next_closing,
            open_due_date=open_due,
        )

    open_forecast = open_due.strftime("%Y-%m")
    closed_forecast = closed_due.strftime("%Y-%m")

    open_amount = max(0.0, _cycle_net(db, account_ids, last_closing, next_closing, open_forecast))
    closed_amount = max(0.0, _cycle_net(db, account_ids, prev_closing, last_closing, closed_forecast))
    payments = _payments_since(db, account_ids, last_closing)
    source = "CALCULATED"

    # Fatura fechada publicada pela Pluggy: vence entre o último e o próximo fechamento
    pluggy_bills = (
        db.query(CreditCardBill)
        .filter(
            CreditCardBill.account_id.in_(account_ids),
            CreditCardBill.due_date > last_closing.date(),
            CreditCardBill.due_date <= next_closing.date(),
        )
        .all()
    )
    if pluggy_bills:
        closed_amount = sum(float(b.total_amount) for b in pluggy_bills)
        payments = max(payments, sum(float(b.paid_amount or 0) for b in pluggy_bills))
        closed_due = min(b.due_date for b in pluggy_bills)
        source = "PLUGGY"

        # Auto-healing de rollover: compras de ciclo anterior que não foram incluídas
        # na fatura fechada oficial publicada (ex: compra processada após o corte do banco)
        # rolam automaticamente para a fatura aberta atual.
        closed_bill_ids = [
            b.pluggy_bill_id
            for b in db.query(CreditCardBill)
            .filter(CreditCardBill.account_id.in_(account_ids), CreditCardBill.pluggy_bill_id.isnot(None))
            .all()
        ]
        rollover_debits = (
            db.query(func.coalesce(func.sum(Transaction.amount), 0))
            .filter(
                Transaction.account_id.in_(account_ids),
                Transaction.type == TransactionType.DEBIT,
                Transaction.is_ignored == 0,
                Transaction.date >= _utc(prev_closing),
                Transaction.date < _utc(last_closing),
                Transaction.bill_forecast_date.is_(None),
                or_(
                    Transaction.pluggy_bill_id.is_(None),
                    Transaction.pluggy_bill_id.notin_(closed_bill_ids),
                ),
            )
            .scalar()
        )
        rollover_credits = (
            db.query(func.coalesce(func.sum(Transaction.amount), 0))
            .filter(
                Transaction.account_id.in_(account_ids),
                Transaction.type == TransactionType.CREDIT,
                Transaction.is_ignored == 0,
                Transaction.date >= _utc(prev_closing),
                Transaction.date < _utc(last_closing),
                Transaction.bill_forecast_date.is_(None),
                func.coalesce(Transaction.category, "") != BILL_PAYMENT_CATEGORY,
                ~Transaction.description.ilike("%pagamento%"),
                or_(
                    Transaction.pluggy_bill_id.is_(None),
                    Transaction.pluggy_bill_id.notin_(closed_bill_ids),
                ),
            )
            .scalar()
        )
        rollover_net = float(rollover_debits or 0) - float(rollover_credits or 0)
        if rollover_net > 0:
            open_amount += rollover_net

    closed_remaining = closed_amount - payments
    if closed_remaining > PAID_TOLERANCE:
        return BillSnapshot(
            amount=round(closed_remaining, 2),
            status="CLOSED",
            source=source,
            cycle_start=prev_closing,
            cycle_end=last_closing,
            due_date=closed_due,
            closed_amount=round(closed_amount, 2),
            open_amount=round(open_amount, 2),
            payments=round(payments, 2),
            open_cycle_end=next_closing,
            open_due_date=open_due,
        )

    # Pagamento acima da fechada não abate a aberta: costuma ser fatura antiga paga
    # com atraso (juros, rotativo), não antecipação
    return BillSnapshot(
        amount=round(open_amount, 2),
        status="OPEN",
        source="CALCULATED",
        cycle_start=last_closing,
        cycle_end=next_closing,
        due_date=open_due,
        closed_amount=round(closed_amount, 2),
        open_amount=round(open_amount, 2),
        payments=round(payments, 2),
        open_cycle_end=next_closing,
        open_due_date=open_due,
    )
