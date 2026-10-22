import unittest
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Account, CreditCardBill, Transaction, TransactionType
from app.services.billing import bill_cycle, compute_bill, due_date_after


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


class BillCycleTest(unittest.TestCase):
    def test_cycle_uses_brasilia_time(self):
        # 21/10 01:00Z ainda é 20/10 em Brasília: ciclo aberto continua o de setembro
        start, end = bill_cycle(21, utc(2026, 10, 21, 1, 0))
        self.assertEqual((start.month, start.day), (9, 21))
        self.assertEqual((end.month, end.day), (10, 21))

        start, end = bill_cycle(21, utc(2026, 10, 21, 3, 0))
        self.assertEqual((start.month, start.day), (10, 21))
        self.assertEqual((end.month, end.day), (11, 21))

    def test_cycle_crosses_year_and_short_months(self):
        start, end = bill_cycle(31, utc(2027, 1, 10, 12))
        self.assertEqual(start.date(), date(2026, 12, 31))
        self.assertEqual(end.date(), date(2027, 1, 31))
        start, end = bill_cycle(31, utc(2027, 2, 15, 12))
        self.assertEqual(end.date(), date(2027, 2, 28))

    def test_due_date_after_closing(self):
        start, _ = bill_cycle(21, utc(2026, 10, 22, 12))
        self.assertEqual(due_date_after(start, 28), date(2026, 10, 28))
        start, _ = bill_cycle(28, utc(2026, 10, 29, 12))
        self.assertEqual(due_date_after(start, 5), date(2026, 11, 5))


class ComputeBillTest(unittest.TestCase):
    NOW = utc(2026, 10, 22, 15, 0)  # dia seguinte ao fechamento (21), vence 28

    def setUp(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.card = Account(name="platinum", type="CREDIT", balance=0, pluggy_account_id="card")
        self.db.add(self.card)
        self.db.flush()
        self._seq = 0

    def tearDown(self):
        self.db.close()

    def tx(self, when, amount, tx_type=TransactionType.DEBIT, category="Compras", ignored=0):
        self._seq += 1
        self.db.add(
            Transaction(
                account_id=self.card.id,
                amount=Decimal(str(amount)),
                date=when,
                description=f"tx {self._seq}",
                category=category,
                type=tx_type,
                pluggy_transaction_id=f"tx-{self._seq}",
                is_ignored=ignored,
            )
        )
        self.db.flush()

    def seed_october(self):
        # Ciclo fechado: 21/09 a 20/10 (Brasília)
        self.tx(utc(2026, 9, 21, 3, 0), 359.42)  # parcela lançada à meia-noite do fechamento
        self.tx(utc(2026, 10, 2, 15, 55), 1000.00)
        self.tx(utc(2026, 10, 21, 2, 30), 50.00)  # 20/10 23:30 em Brasília
        # Ciclo aberto: a partir de 21/10 (Brasília)
        self.tx(utc(2026, 10, 21, 3, 0), 359.40)  # parcela 2/3 do novo ciclo
        self.tx(utc(2026, 10, 21, 22, 1), 24.98)
        self.tx(utc(2026, 10, 21, 12, 0), 0.80, TransactionType.CREDIT, "Digital services")
        # Parcela futura não entra em nenhuma das duas
        self.tx(utc(2026, 11, 30, 3, 0), 359.40)

    def test_closed_unpaid_bill_is_the_one_to_pay(self):
        self.seed_october()
        bill = compute_bill(self.db, [self.card.id], 21, 28, self.NOW)
        self.assertEqual(bill.status, "CLOSED")
        self.assertEqual(bill.amount, 1409.42)
        self.assertEqual(bill.closed_amount, 1409.42)
        self.assertEqual(bill.open_amount, 383.58)
        self.assertEqual(bill.due_date, date(2026, 10, 28))
        self.assertEqual(bill.source, "CALCULATED")

    def test_after_payment_shows_open_bill(self):
        self.seed_october()
        self.tx(utc(2026, 10, 27, 12), 1409.42, TransactionType.CREDIT, "Pagamento de Fatura", 1)
        bill = compute_bill(self.db, [self.card.id], 21, 28, utc(2026, 10, 27, 13))
        self.assertEqual(bill.status, "OPEN")
        self.assertEqual(bill.amount, 383.58)
        self.assertEqual(bill.due_date, date(2026, 11, 28))

    def test_partial_payment_leaves_remaining(self):
        self.seed_october()
        self.tx(utc(2026, 10, 25, 12), 409.42, TransactionType.CREDIT, "Pagamento de Fatura", 1)
        bill = compute_bill(self.db, [self.card.id], 21, 28, utc(2026, 10, 25, 13))
        self.assertEqual(bill.status, "CLOSED")
        self.assertEqual(bill.amount, 1000.00)

    def test_overpayment_does_not_reduce_open_bill(self):
        self.seed_october()
        self.tx(utc(2026, 10, 25, 12), 1509.42, TransactionType.CREDIT, "Pagamento de Fatura", 1)
        bill = compute_bill(self.db, [self.card.id], 21, 28, utc(2026, 10, 25, 13))
        self.assertEqual(bill.status, "OPEN")
        self.assertEqual(bill.amount, 383.58)

    def test_pluggy_bill_overrides_calculated_amount(self):
        self.seed_october()
        self.db.add(
            CreditCardBill(
                account_id=self.card.id,
                pluggy_bill_id="bill-oct",
                due_date=date(2026, 10, 28),
                total_amount=Decimal("1418.51"),
                paid_amount=Decimal("0"),
            )
        )
        self.db.flush()
        bill = compute_bill(self.db, [self.card.id], 21, 28, self.NOW)
        self.assertEqual(bill.status, "CLOSED")
        self.assertEqual(bill.source, "PLUGGY")
        self.assertEqual(bill.amount, 1418.51)

    def test_no_credit_account(self):
        bill = compute_bill(self.db, [], 21, 28, self.NOW)
        self.assertEqual(bill.amount, 0.0)
        self.assertEqual(bill.status, "OPEN")


if __name__ == "__main__":
    unittest.main()
