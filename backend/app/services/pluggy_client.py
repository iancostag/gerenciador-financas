import os
import logging
from pathlib import Path
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional
import requests
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.models import Account, CreditCardBill, Transaction, TransactionType

logger = logging.getLogger(__name__)
ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


def dialect_insert(db: Session, model):
    """Retorna o construtor INSERT com suporte a ON CONFLICT DO UPDATE (PostgreSQL ou SQLite)."""
    dialect_name = db.bind.dialect.name if db.bind is not None else "postgresql"
    if dialect_name == "sqlite":
        return sqlite_insert(model)
    return pg_insert(model)


def parse_pluggy_date(raw: Optional[str]) -> Optional[date]:
    """Datas de calendário da Pluggy (vencimento, fechamento) vêm como ISO; usa só o dia."""
    if not raw or not isinstance(raw, str):
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        return None


def parse_pluggy_datetime(raw_str: Optional[str]) -> Optional[datetime]:
    if not raw_str or not isinstance(raw_str, str):
        return None
    try:
        return datetime.fromisoformat(raw_str.replace("Z", "+00:00"))
    except Exception:
        return None


class PluggyClientError(Exception):
    """Exceção customizada para falhas na comunicação com a API da Pluggy."""


class PluggyClient:
    BASE_URL = "https://api.pluggy.ai"

    def __init__(
        self,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        item_id: Optional[str] = None,
    ):
        load_dotenv(dotenv_path=ROOT_ENV, override=True)
        load_dotenv(override=True)

        self.client_id = (client_id or os.getenv("PLUGGY_CLIENT_ID", "")).strip()
        self.client_secret = (
            client_secret or os.getenv("PLUGGY_CLIENT_SECRET", "")
        ).strip()

        raw_items = (
            item_id
            or os.getenv("PLUGGY_ITEM_ID", "")
            or os.getenv("PLUGGY_ITEM_IDS", "")
        )
        self.item_ids = [i.strip() for i in raw_items.split(",") if i.strip()]

        raw_accounts = os.getenv("PLUGGY_ACCOUNT_IDS", "")
        self.account_ids = [a.strip() for a in raw_accounts.split(",") if a.strip()]
        self._api_key: Optional[str] = None

    def authenticate(self) -> str:
        if not self.client_id or not self.client_secret:
            raise PluggyClientError(
                "PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET devem estar configurados no .env."
            )

        response = requests.post(
            f"{self.BASE_URL}/auth",
            json={
                "clientId": self.client_id,
                "clientSecret": self.client_secret,
            },
            timeout=20,
        )
        if response.status_code != 200:
            raise PluggyClientError(
                f"Falha na autenticação Pluggy ({response.status_code}): {response.text}"
            )

        api_key = response.json().get("apiKey")
        if not api_key:
            raise PluggyClientError("Resposta de autenticação Pluggy não contém 'apiKey'.")

        self._api_key = api_key
        return api_key

    @property
    def headers(self) -> Dict[str, str]:
        if not self._api_key:
            self.authenticate()
        return {
            "X-API-KEY": self._api_key or "",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def fetch_accounts(self) -> List[Dict[str, Any]]:
        if not self.item_ids and not self.account_ids:
            raise PluggyClientError(
                "Defina PLUGGY_ITEM_ID no arquivo .env antes de sincronizar."
            )

        accounts: List[Dict[str, Any]] = []

        for item_id in self.item_ids:
            resp = requests.get(
                f"{self.BASE_URL}/accounts",
                headers=self.headers,
                params={"itemId": item_id},
                timeout=25,
            )
            if resp.status_code != 200:
                raise PluggyClientError(
                    f"Erro ao buscar contas do itemId {item_id} ({resp.status_code}): {resp.text}"
                )
            results = resp.json().get("results", [])
            accounts.extend(results)

        if not accounts and self.account_ids:
            for acc_id in self.account_ids:
                acc_resp = requests.get(
                    f"{self.BASE_URL}/accounts/{acc_id}",
                    headers=self.headers,
                    timeout=20,
                )
                if acc_resp.status_code == 200:
                    accounts.append(acc_resp.json())
                else:
                    accounts.append(
                        {
                            "id": acc_id,
                            "name": "Conta Pluggy",
                            "type": "BANK",
                            "balance": 0.0,
                            "currencyCode": "BRL",
                        }
                    )

        return accounts

    def fetch_bills(self, pluggy_account_id: str) -> List[Dict[str, Any]]:
        """
        Busca as faturas fechadas do cartão em GET /bills?accountId={id}.
        Nem todo conector/plano expõe faturas: em caso de erro retorna lista vazia
        e o cálculo da fatura cai para a soma das transações.
        """
        try:
            resp = requests.get(
                f"{self.BASE_URL}/bills",
                headers=self.headers,
                params={"accountId": pluggy_account_id, "pageSize": 500},
                timeout=25,
            )
        except requests.RequestException as exc:
            logger.warning("Falha ao buscar faturas da conta %s: %s", pluggy_account_id, exc)
            return []
        if resp.status_code != 200:
            logger.warning(
                "Faturas indisponíveis para a conta %s (%s): %s",
                pluggy_account_id,
                resp.status_code,
                resp.text,
            )
            return []
        return resp.json().get("results", []) or []

    def fetch_transactions(
        self,
        pluggy_account_id: str,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        all_transactions: List[Dict[str, Any]] = []
        next_query: Optional[str] = None
        seen_cursors: set = set()
        page_count = 0
        max_pages = 60

        initial_params: Dict[str, Any] = {
            "accountId": pluggy_account_id,
        }
        if date_from:
            initial_params["from"] = date_from
        if date_to:
            initial_params["to"] = date_to

        while True:
            page_count += 1
            if page_count > max_pages:
                break

            if next_query:
                if next_query.startswith("?"):
                    request_url = f"{self.BASE_URL}/v2/transactions{next_query}"
                    request_params = None
                elif next_query.startswith("http"):
                    request_url = next_query
                    request_params = None
                else:
                    request_url = f"{self.BASE_URL}/v2/transactions"
                    request_params = {
                        "accountId": pluggy_account_id,
                        "after": next_query,
                    }
            else:
                request_url = f"{self.BASE_URL}/v2/transactions"
                request_params = initial_params

            resp = requests.get(
                request_url,
                headers=self.headers,
                params=request_params,
                timeout=30,
            )
            if resp.status_code != 200:
                raise PluggyClientError(
                    f"Erro ao buscar transações em /v2/transactions para a conta {pluggy_account_id} "
                    f"({resp.status_code}): {resp.text}"
                )

            payload = resp.json()
            results = payload.get("results", [])
            all_transactions.extend(results)

            next_query = payload.get("next")
            if not next_query or next_query in seen_cursors:
                break
            seen_cursors.add(next_query)

        return all_transactions

    @staticmethod
    def _parse_transaction_json(
        raw_tx: Dict[str, Any], local_account_id: int
    ) -> Dict[str, Any]:
        merchant = raw_tx.get("merchant") or {}
        merchant_name = (
            merchant.get("name")
            or merchant.get("businessName")
            or raw_tx.get("description")
        )
        merchant_cnpj = merchant.get("cnpj")
        category = raw_tx.get("category") or "Outros"

        raw_type = (raw_tx.get("type") or "DEBIT").upper()
        tx_type = (
            TransactionType.CREDIT
            if raw_type == "CREDIT"
            else TransactionType.DEBIT
        )

        raw_amount = abs(Decimal(str(raw_tx.get("amount", 0.0))))
        raw_date_str = raw_tx.get("date")
        tx_date = (
            datetime.fromisoformat(raw_date_str.replace("Z", "+00:00"))
            if raw_date_str
            else datetime.now(timezone.utc)
        )

        cc_meta = raw_tx.get("creditCardMetadata") or {}
        raw_bill_id = cc_meta.get("billId")
        bill_id = str(raw_bill_id) if raw_bill_id is not None else None

        inst_num = cc_meta.get("installmentNumber")
        installment_number = int(inst_num) if inst_num is not None else None

        tot_inst = cc_meta.get("totalInstallments")
        total_installments = int(tot_inst) if tot_inst is not None else None

        raw_forecast = cc_meta.get("billForecastDate")
        bill_forecast_date = str(raw_forecast).strip() if raw_forecast else None

        return {
            "account_id": local_account_id,
            "amount": raw_amount,
            "date": tx_date,
            "description": raw_tx.get("description") or "Sem descrição",
            "merchant_name": merchant_name,
            "merchant_cnpj": merchant_cnpj,
            "category": category,
            "type": tx_type,
            "pluggy_transaction_id": str(raw_tx["id"]),
            "bill_id": bill_id,
            "pluggy_bill_id": bill_id,
            "bill_forecast_date": bill_forecast_date,
            "installment_number": installment_number,
            "total_installments": total_installments,
        }

    def _upsert_bills(self, db: Session, pluggy_acc_id: str, local_account_id: int) -> None:
        for raw_bill in self.fetch_bills(pluggy_acc_id):
            due_date = parse_pluggy_date(raw_bill.get("dueDate"))
            if not raw_bill.get("id") or due_date is None:
                continue
            paid = sum(
                abs(Decimal(str(p.get("amount") or 0)))
                for p in raw_bill.get("payments") or []
            )
            min_payment = raw_bill.get("minimumPaymentAmount")
            bill_values = {
                "account_id": local_account_id,
                "pluggy_bill_id": str(raw_bill["id"]),
                "due_date": due_date,
                "closing_date": parse_pluggy_date(
                    raw_bill.get("billClosingDate") or raw_bill.get("closeDate")
                ),
                "total_amount": Decimal(str(raw_bill.get("totalAmount") or 0)),
                "minimum_payment_amount": (
                    Decimal(str(min_payment)) if min_payment is not None else None
                ),
                "paid_amount": paid,
                "state": raw_bill.get("state"),
            }
            stmt = (
                dialect_insert(db, CreditCardBill)
                .values(**bill_values)
                .on_conflict_do_update(
                    index_elements=[CreditCardBill.pluggy_bill_id],
                    set_={
                        k: v for k, v in bill_values.items() if k != "pluggy_bill_id"
                    },
                )
            )
            db.execute(stmt)

    def sync_to_database(
        self,
        db: Session,
        date_from: Optional[str] = None,
    ) -> Dict[str, int]:
        self.authenticate()
        raw_accounts = self.fetch_accounts()

        accounts_synced = 0
        transactions_upserted = 0

        for raw_acc in raw_accounts:
            pluggy_acc_id = str(raw_acc["id"])
            credit_data = raw_acc.get("creditData") or {}
            close_dt = parse_pluggy_datetime(credit_data.get("balanceCloseDate"))
            due_dt = parse_pluggy_datetime(credit_data.get("balanceDueDate"))

            acc_values = {
                "name": raw_acc.get("name") or "Conta Pluggy",
                "type": raw_acc.get("type") or "BANK",
                "balance": Decimal(str(raw_acc.get("balance", 0.0))),
                "currency": raw_acc.get("currencyCode") or "BRL",
                "pluggy_account_id": pluggy_acc_id,
                "bill_close_date": parse_pluggy_date(credit_data.get("balanceCloseDate")),
                "bill_due_date": parse_pluggy_date(credit_data.get("balanceDueDate")),
                "balance_close_date": close_dt,
                "balance_due_date": due_dt,
            }

            acc_stmt = (
                dialect_insert(db, Account)
                .values(**acc_values)
                .on_conflict_do_update(
                    index_elements=[Account.pluggy_account_id],
                    set_={
                        "name": acc_values["name"],
                        "type": acc_values["type"],
                        "balance": acc_values["balance"],
                        "currency": acc_values["currency"],
                        "bill_close_date": acc_values["bill_close_date"],
                        "bill_due_date": acc_values["bill_due_date"],
                        "balance_close_date": acc_values["balance_close_date"],
                        "balance_due_date": acc_values["balance_due_date"],
                    },
                )
                .returning(Account.id)
            )
            local_account_id = db.execute(acc_stmt).scalar_one()
            accounts_synced += 1

            if acc_values["type"] == "CREDIT":
                self._upsert_bills(db, pluggy_acc_id, local_account_id)

            raw_transactions = self.fetch_transactions(
                pluggy_account_id=pluggy_acc_id, date_from=date_from
            )

            for raw_tx in raw_transactions:
                tx_values = self._parse_transaction_json(raw_tx, local_account_id)

                tx_stmt = (
                    dialect_insert(db, Transaction)
                    .values(**tx_values)
                    .on_conflict_do_update(
                        index_elements=[Transaction.pluggy_transaction_id],
                        set_={
                            "amount": tx_values["amount"],
                            "date": tx_values["date"],
                            "description": tx_values["description"],
                            "merchant_name": tx_values["merchant_name"],
                            "merchant_cnpj": tx_values["merchant_cnpj"],
                            "category": tx_values["category"],
                            "type": tx_values["type"],
                            "bill_id": tx_values["bill_id"],
                            "pluggy_bill_id": tx_values["pluggy_bill_id"],
                            "bill_forecast_date": tx_values["bill_forecast_date"],
                            "installment_number": tx_values["installment_number"],
                            "total_installments": tx_values["total_installments"],
                        },
                    )
                )
                db.execute(tx_stmt)
                transactions_upserted += 1

        db.commit()
        return {
            "accounts_synced": accounts_synced,
            "transactions_upserted": transactions_upserted,
        }
