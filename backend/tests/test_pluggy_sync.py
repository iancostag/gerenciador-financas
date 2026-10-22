import unittest
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Account, CreditCardBill, Transaction
from app.services.pluggy_client import PluggyClient


class FakePluggyClient(PluggyClient):
    def __init__(self, bills):
        super().__init__(client_id="id", client_secret="secret", item_id="item")
        self._bills = bills

    def authenticate(self):
        self._api_key = "key"
        return self._api_key

    def fetch_accounts(self):
        return [
            {
                "id": "card-1",
                "name": "platinum",
                "type": "CREDIT",
                "balance": 4324.41,
                "currencyCode": "BRL",
                "creditData": {
                    "balanceCloseDate": "2026-10-21T03:00:00.000Z",
                    "balanceDueDate": "2026-10-28T03:00:00.000Z",
                },
            }
        ]

    def fetch_transactions(self, pluggy_account_id, date_from=None, date_to=None):
        return [
            {
                "id": "tx-1",
                "amount": 359.40,
                "date": "2026-10-21T03:00:00.000Z",
                "description": "Latam Air*Jjsxhx 2/3",
                "type": "DEBIT",
                "creditCardMetadata": {
                    "billId": "bill-oct",
                    "installmentNumber": 2,
                    "totalInstallments": 3,
                },
            }
        ]

    def fetch_bills(self, pluggy_account_id):
        return self._bills


class PluggySyncTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()

    def tearDown(self):
        self.db.close()

    def test_sync_stores_card_dates_metadata_and_bills(self):
        bills = [
            {
                "id": "bill-oct",
                "dueDate": "2026-10-28T00:00:00.000Z",
                "billClosingDate": "2026-10-21T00:00:00.000Z",
                "totalAmount": 2088.11,
                "minimumPaymentAmount": 313.22,
                "payments": [{"id": "p1", "amount": 88.11}],
            }
        ]
        FakePluggyClient(bills).sync_to_database(self.db)
        # Segunda sync atualiza a mesma fatura (upsert)
        bills[0]["payments"].append({"id": "p2", "amount": 2000.0})
        FakePluggyClient(bills).sync_to_database(self.db)

        account = self.db.query(Account).one()
        self.assertEqual(account.bill_close_date, date(2026, 10, 21))
        self.assertEqual(account.bill_due_date, date(2026, 10, 28))

        tx = self.db.query(Transaction).one()
        self.assertEqual(tx.bill_id, "bill-oct")
        self.assertEqual((tx.installment_number, tx.total_installments), (2, 3))

        bill = self.db.query(CreditCardBill).one()
        self.assertEqual(bill.due_date, date(2026, 10, 28))
        self.assertEqual(float(bill.total_amount), 2088.11)
        self.assertEqual(float(bill.paid_amount), 2088.11)


if __name__ == "__main__":
    unittest.main()
