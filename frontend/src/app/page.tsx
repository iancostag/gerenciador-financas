"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  RefreshCw,
  Wallet,
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Calendar,
  Search,
  ExternalLink,
  Check,
  X,
  Clock,
  Pencil,
  Sparkles,
  SlidersHorizontal,
  Plus,
  Trash2,
  Receipt,
  Home,
  Target,
  ArrowRight,
  Download,
  ChevronDown,
  Calculator,
  HelpCircle,
  PiggyBank,
  Box,
  Settings,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" && (window.location.port === "8000" || window.location.port === "")
    ? "/api/v1"
    : "http://localhost:8000/api/v1");

const CATEGORY_BAR_COLORS = [
  "#4f46e5", // Indigo
  "#0284c7", // Sky
  "#9333ea", // Purple
  "#d97706", // Amber
  "#64748b", // Slate
  "#10b981", // Emerald
  "#e11d48", // Rose
];

interface CategoryExpense {
  category: str;
  total: number;
}
type str = string;

interface FutureCommitmentItem {
  month: string;
  label: string;
  total: number;
  count: number;
}

interface AccountItem {
  id: number;
  name: string;
  type: string;
  balance: number;
  currency: string;
  pluggy_account_id: string;
}

interface SalaryProjection {
  salary: number;
  bank_balance: number;
  credit_balance: number;
  current_bill: number;
  recurring_bills_total: number;
  recurring_bills_pending: number;
  caixinhas_liquid_total: number;
  caixinhas_total: number;
  is_bill_custom: boolean;
  bill_closing_day: number;
  bill_due_day: number;
  bill_cycle_start: string;
  bill_cycle_end: string;
  bill_status?: "OPEN" | "CLOSED";
  bill_source?: "PLUGGY" | "CALCULATED";
  bill_due_date?: string;
  bill_closed_amount?: number;
  bill_open_amount?: number;
  total_available: number;
  free_balance: number;
  days_remaining?: number;
  commitment_percentage: number;
  daily_budget: number;
  status: "CRITICAL" | "WARNING" | "HEALTHY";
}

interface CaixinhaItem {
  id: number;
  name: string;
  balance: number;
  include_in_free_balance: boolean;
  linked_goal_id?: number | null;
  linked_goal_name?: string | null;
  updated_at?: string;
}

interface RecurringBillItem {
  id: number;
  name: string;
  amount: number;
  due_day: number;
  category: string;
  is_active: boolean;
  is_paid_this_month: boolean;
  created_at?: string;
}

interface RecurringBillsSummary {
  total_monthly: number;
  total_paid: number;
  total_pending: number;
  items: RecurringBillItem[];
}

interface FinancialGoalItem {
  id: number;
  name: string;
  current_amount: number;
  target_amount: number;
  color: string;
  progress_percentage: number;
  created_at?: string;
}

interface DashboardMetrics {
  bank_balance: number;
  credit_balance: number;
  net_balance: number;
  current_balance: number;
  monthly_income: number;
  monthly_expenses: number;
  future_commitments_total: number;
  future_commitments: FutureCommitmentItem[];
  expenses_by_category: CategoryExpense[];
  accounts: AccountItem[];
  salary_projection?: SalaryProjection;
}

interface TransactionItem {
  id: number;
  account_id: number;
  account_name?: string | null;
  account_type?: string | null;
  amount: number;
  date: string;
  description: string;
  merchant_name?: string | null;
  merchant_cnpj?: string | null;
  category?: string | null;
  type: "DEBIT" | "CREDIT";
  pluggy_transaction_id: string;
  is_ignored?: boolean;
}

interface PaginatedTransactions {
  items: TransactionItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Helper para separar reais e centavos com elegância tipográfica
function splitCurrencyParts(value: number) {
  const absVal = Math.abs(value || 0);
  const formatted = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absVal);
  const [integerPart, centsPart] = formatted.split(",");
  const prefix = value < 0 ? "-R$ " : "R$ ";
  return { prefix, integerPart, centsPart: `,${centsPart || "00"}` };
}

// Helper para cores de badges de categoria
function getCategoryBadgeStyle(category?: string | null) {
  const cat = (category || "Outros").toLowerCase();
  if (cat.includes("aliment") || cat.includes("supermercado") || cat.includes("ifood")) {
    return "bg-orange-50 text-orange-700 border-orange-200/60";
  }
  if (cat.includes("moradia") || cat.includes("casa") || cat.includes("luz") || cat.includes("utilidades")) {
    return "bg-blue-50 text-blue-700 border-blue-200/60";
  }
  if (cat.includes("assinatura") || cat.includes("servi") || cat.includes("internet")) {
    return "bg-purple-50 text-purple-700 border-purple-200/60";
  }
  if (cat.includes("transporte") || cat.includes("uber")) {
    return "bg-sky-50 text-sky-700 border-sky-200/60";
  }
  if (cat.includes("saúde") || cat.includes("saude") || cat.includes("academia")) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200/60";
  }
  if (cat.includes("família") || cat.includes("familia")) {
    return "bg-indigo-50 text-indigo-700 border-indigo-200/60";
  }
  if (cat.includes("compra")) {
    return "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200/60";
  }
  if (cat.includes("renda") || cat.includes("salário") || cat.includes("salario") || cat.includes("transfer")) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200/60";
  }
  return "bg-slate-100 text-slate-700 border-slate-200/60";
}

// Helper para Avatar de Estabelecimento (estilo Figma)
function getMerchantAvatar(name: string) {
  const clean = (name || "TX").trim();
  const lower = clean.toLowerCase();

  if (lower.includes("ifood") || lower.includes("ifd")) {
    return { initials: "iF", bg: "bg-rose-100 text-rose-600" };
  }
  if (lower.includes("uber")) {
    return { initials: "U", bg: "bg-slate-900 text-white" };
  }
  if (lower.includes("spotify")) {
    return { initials: "Sp", bg: "bg-emerald-100 text-emerald-700" };
  }
  if (lower.includes("amazon") || lower.includes("amzn")) {
    return { initials: "a", bg: "bg-amber-100 text-amber-800" };
  }
  if (lower.includes("netflix")) {
    return { initials: "N", bg: "bg-red-100 text-red-700" };
  }
  if (lower.includes("nubank") || lower.includes("nu ")) {
    return { initials: "Nu", bg: "bg-purple-100 text-purple-700" };
  }
  if (lower.includes("mercado") || lower.includes("mp ")) {
    return { initials: "MP", bg: "bg-sky-100 text-sky-700" };
  }
  const words = clean.split(/\s+/);
  const initials =
    words.length >= 2
      ? `${words[0][0]}${words[1][0]}`.toUpperCase()
      : clean.slice(0, 2).toUpperCase();

  return { initials, bg: "bg-slate-100 text-slate-700" };
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    bank_balance: 0,
    credit_balance: 0,
    net_balance: 0,
    current_balance: 0,
    monthly_income: 0,
    monthly_expenses: 0,
    future_commitments_total: 0,
    future_commitments: [],
    expenses_by_category: [],
    accounts: [],
  });

  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);

  // 4 Abas do Design Figma
  const [activeTab, setActiveTab] = useState<
    "overview" | "recurring" | "transactions" | "goals"
  >("overview");

  // Simulador "Cabe no meu bolso?"
  const [simulatorInput, setSimulatorInput] = useState<string>("");

  // Contas Fixas & Recorrentes
  const [recurringSummary, setRecurringSummary] =
    useState<RecurringBillsSummary | null>(null);
  const [billSearchQuery, setBillSearchQuery] = useState<string>("");
  const [billCategoryFilter, setBillCategoryFilter] = useState<string>("Todas");
  const [isBillModalOpen, setIsBillModalOpen] = useState<boolean>(false);
  const [editingBillItem, setEditingBillItem] =
    useState<RecurringBillItem | null>(null);
  const [billFormName, setBillFormName] = useState<string>("");
  const [billFormAmount, setBillFormAmount] = useState<string>("");
  const [billFormDueDay, setBillFormDueDay] = useState<number>(10);
  const [billFormCategory, setBillFormCategory] = useState<string>("Moradia");
  const [savingBill, setSavingBill] = useState<boolean>(false);

  // Metas Financeiras (Aba 4)
  const [goals, setGoals] = useState<FinancialGoalItem[]>([]);
  const [isGoalModalOpen, setIsGoalModalOpen] = useState<boolean>(false);
  const [editingGoal, setEditingGoal] = useState<FinancialGoalItem | null>(null);
  const [goalFormName, setGoalFormName] = useState<string>("");
  const [goalFormCurrent, setGoalFormCurrent] = useState<string>("");
  const [goalFormTarget, setGoalFormTarget] = useState<string>("");
  const [goalFormColor, setGoalFormColor] = useState<string>("emerald");
  const [savingGoal, setSavingGoal] = useState<boolean>(false);

  // Caixinhas Mercado Pago (Reservas)
  const [caixinhas, setCaixinhas] = useState<CaixinhaItem[]>([]);
  const [isCaixinhaModalOpen, setIsCaixinhaModalOpen] = useState<boolean>(false);
  const [editingCaixinhaId, setEditingCaixinhaId] = useState<number | null>(null);
  const [editCaixinhaBalance, setEditCaixinhaBalance] = useState<string>("");
  const [savingCaixinha, setSavingCaixinha] = useState<boolean>(false);
  const [newCaixinhaName, setNewCaixinhaName] = useState<string>("");
  const [newCaixinhaBalance, setNewCaixinhaBalance] = useState<string>("");
  const [isCreatingCaixinha, setIsCreatingCaixinha] = useState<boolean>(false);

  // Configuração do Salário
  const [isEditingSalary, setIsEditingSalary] = useState<boolean>(false);
  const [salaryInput, setSalaryInput] = useState<string>("0");
  const [savingSalary, setSavingSalary] = useState<boolean>(false);

  // Configuração do Ciclo e Fatura do Cartão
  const [isCardModalOpen, setIsCardModalOpen] = useState<boolean>(false);
  const [closingDayInput, setClosingDayInput] = useState<number>(2);
  const [dueDayInput, setDueDayInput] = useState<number>(10);
  const [billMode, setBillMode] = useState<"auto" | "custom">("auto");
  const [customBillInput, setCustomBillInput] = useState<string>("0");
  const [savingCardSettings, setSavingCardSettings] = useState<boolean>(false);

  // Configurações Globais (Nome e Pluggy)
  const [userName, setUserName] = useState<string>("");
  const [pluggyConfigured, setPluggyConfigured] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [settingsFormName, setSettingsFormName] = useState<string>("");
  const [settingsFormClientId, setSettingsFormClientId] = useState<string>("");
  const [settingsFormClientSecret, setSettingsFormClientSecret] = useState<string>("");
  const [savingSettings, setSavingSettings] = useState<boolean>(false);

  // Filtros de Transações
  const [period, setPeriod] = useState<"current_month" | "future" | "all">(
    "current_month"
  );
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Edição de Categoria
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [editCategoryValue, setEditCategoryValue] = useState<string>("");
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Carrega categorias disponíveis
  useEffect(() => {
    fetch(`${API_BASE_URL.replace("/api/v1", "")}/api/v1/categories`)
      .then((res) => res.json())
      .then((data) => {
        if (data.categories) setAvailableCategories(data.categories);
      })
      .catch(() => {});
  }, []);

  // Busca dados da API
  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(currentPage));
      params.set("page_size", "15");
      params.set("period", period);
      if (selectedAccountId !== null) {
        params.set("account_id", String(selectedAccountId));
      }
      if (searchQuery.trim()) {
        params.set("search", searchQuery.trim());
      }

      const [metricsRes, txRes, recRes, goalsRes, caixinhasRes, settingsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/metrics`),
        fetch(`${API_BASE_URL}/transactions?${params.toString()}`),
        fetch(`${API_BASE_URL}/recurring-bills`),
        fetch(`${API_BASE_URL}/goals`),
        fetch(`${API_BASE_URL}/caixinhas`),
        fetch(`${API_BASE_URL}/settings`),
      ]);

      if (!metricsRes.ok || !txRes.ok) {
        throw new Error("Falha ao carregar dados do backend.");
      }

      const metricsData: DashboardMetrics = await metricsRes.json();
      const txData: PaginatedTransactions = await txRes.json();

      setMetrics(metricsData);
      setTransactions(txData.items);
      setTotalCount(txData.total);
      setTotalPages(txData.total_pages);

      if (settingsRes && settingsRes.ok) {
        const sData = await settingsRes.json();
        setUserName(sData.user_name || "");
        setSettingsFormName(sData.user_name || "");
        setPluggyConfigured(Boolean(sData.pluggy_configured));
      }

      if (recRes.ok) {
        const recData: RecurringBillsSummary = await recRes.json();
        setRecurringSummary(recData);
      }

      if (goalsRes.ok) {
        const goalsData: FinancialGoalItem[] = await goalsRes.json();
        setGoals(goalsData);
      }

      if (caixinhasRes && caixinhasRes.ok) {
        const caixinhasData: CaixinhaItem[] = await caixinhasRes.json();
        setCaixinhas(caixinhasData);
      }

      if (metricsData.salary_projection) {
        const p = metricsData.salary_projection;
        setSalaryInput(String(p.salary));
        setClosingDayInput(p.bill_closing_day || 2);
        setDueDayInput(p.bill_due_day || 10);
        if (p.is_bill_custom) {
          setBillMode("custom");
          setCustomBillInput(String(p.current_bill));
        } else {
          setBillMode("auto");
          setCustomBillInput(String(p.current_bill || ""));
        }
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        message:
          err?.message ||
          "Não foi possível conectar à API FastAPI em localhost:8000.",
      });
    } finally {
      setLoading(false);
    }
  }, [currentPage, period, selectedAccountId, searchQuery]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Sincronizar com Meu Pluggy
  const handleSync = async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await fetch(`${API_BASE_URL}/sync`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Erro ao sincronizar com a Pluggy.");
      }

      setFeedback({
        type: "success",
        message: data.message || "Dados sincronizados com sucesso!",
      });
      await fetchDashboardData();
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err?.message || "Erro inesperado ao sincronizar.",
      });
    } finally {
      setSyncing(false);
    }
  };

  // Salvar novo salário
  const handleSaveSalary = async () => {
    const num = parseFloat(salaryInput.replace(",", "."));
    if (isNaN(num) || num < 0) {
      setIsEditingSalary(false);
      return;
    }
    setSavingSalary(true);
    try {
      const res = await fetch(`${API_BASE_URL}/settings/salary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salary: num }),
      });
      if (res.ok) {
        const newProj: SalaryProjection = await res.json();
        setMetrics((prev) => ({ ...prev, salary_projection: newProj }));
        setIsEditingSalary(false);
        setFeedback({
          type: "success",
          message: `Salário base atualizado para ${formatCurrency(num)}!`,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingSalary(false);
    }
  };

  // Salvar configurações do cartão
  const handleSaveCardSettings = async () => {
    setSavingCardSettings(true);
    try {
      const payload: any = {
        closing_day: Number(closingDayInput),
        due_day: Number(dueDayInput),
      };
      if (billMode === "auto") {
        payload.use_auto_bill = true;
      } else {
        const num = parseFloat(customBillInput.replace(",", "."));
        if (!isNaN(num) && num >= 0) {
          payload.custom_bill_amount = num;
        }
      }

      const res = await fetch(`${API_BASE_URL}/settings/card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const newProj: SalaryProjection = await res.json();
        setMetrics((prev) => ({ ...prev, salary_projection: newProj }));
        setIsCardModalOpen(false);
        setFeedback({
          type: "success",
          message: "Configurações da fatura e ciclo atualizadas com sucesso!",
        });
      }
    } catch (e: any) {
      console.error(e);
      setFeedback({
        type: "error",
        message: "Erro ao salvar configurações do cartão.",
      });
    } finally {
      setSavingCardSettings(false);
    }
  };

  // Contas Fixas CRUD
  const handleOpenNewBill = () => {
    setEditingBillItem(null);
    setBillFormName("");
    setBillFormAmount("");
    setBillFormDueDay(10);
    setBillFormCategory("Família");
    setIsBillModalOpen(true);
  };

  const handleOpenEditBill = (b: RecurringBillItem) => {
    setEditingBillItem(b);
    setBillFormName(b.name);
    setBillFormAmount(String(b.amount));
    setBillFormDueDay(b.due_day);
    setBillFormCategory(b.category);
    setIsBillModalOpen(true);
  };

  const handleSaveBill = async () => {
    if (!billFormName.trim()) return;
    const amountNum = parseFloat(billFormAmount.replace(",", "."));
    if (isNaN(amountNum) || amountNum <= 0) return;

    setSavingBill(true);
    try {
      if (editingBillItem) {
        await fetch(`${API_BASE_URL}/recurring-bills/${editingBillItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: billFormName.trim(),
            amount: amountNum,
            due_day: Number(billFormDueDay),
            category: billFormCategory.trim(),
          }),
        });
      } else {
        await fetch(`${API_BASE_URL}/recurring-bills`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: billFormName.trim(),
            amount: amountNum,
            due_day: Number(billFormDueDay),
            category: billFormCategory.trim(),
          }),
        });
      }
      setIsBillModalOpen(false);
      fetchDashboardData();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingBill(false);
    }
  };

  const handleDeleteBill = async (billId: number, name: string) => {
    if (!confirm(`Deseja realmente excluir a conta fixa "${name}"?`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/recurring-bills/${billId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchDashboardData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleTogglePaidBill = async (billId: number) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/recurring-bills/${billId}/toggle-paid`,
        {
          method: "POST",
        }
      );
      if (res.ok) {
        fetchDashboardData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Metas CRUD
  const handleOpenNewGoal = () => {
    setEditingGoal(null);
    setGoalFormName("");
    setGoalFormCurrent("0");
    setGoalFormTarget("5000");
    setGoalFormColor("emerald");
    setIsGoalModalOpen(true);
  };

  const handleOpenEditGoal = (g: FinancialGoalItem) => {
    setEditingGoal(g);
    setGoalFormName(g.name);
    setGoalFormCurrent(String(g.current_amount));
    setGoalFormTarget(String(g.target_amount));
    setGoalFormColor(g.color || "emerald");
    setIsGoalModalOpen(true);
  };

  const handleSaveGoal = async () => {
    if (!goalFormName.trim()) return;
    const curr = parseFloat(goalFormCurrent.replace(",", ".")) || 0;
    const targ = parseFloat(goalFormTarget.replace(",", ".")) || 1000;

    setSavingGoal(true);
    try {
      if (editingGoal) {
        await fetch(`${API_BASE_URL}/goals/${editingGoal.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: goalFormName.trim(),
            current_amount: curr,
            target_amount: targ,
            color: goalFormColor,
          }),
        });
      } else {
        await fetch(`${API_BASE_URL}/goals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: goalFormName.trim(),
            current_amount: curr,
            target_amount: targ,
            color: goalFormColor,
          }),
        });
      }
      setIsGoalModalOpen(false);
      fetchDashboardData();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingGoal(false);
    }
  };

  const handleDeleteGoal = async (goalId: number, name: string) => {
    if (!confirm(`Deseja realmente excluir a meta "${name}"?`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/goals/${goalId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchDashboardData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Caixinhas Handlers
  const handleToggleCaixinhaCDI = async (id: number, current: boolean) => {
    try {
      await fetch(`${API_BASE_URL}/caixinhas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ include_in_free_balance: !current }),
      });
      fetchDashboardData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleLinkCaixinhaGoal = async (id: number, goalId: number | null) => {
    try {
      await fetch(`${API_BASE_URL}/caixinhas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linked_goal_id: goalId }),
      });
      fetchDashboardData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveCaixinhaBalance = async (id: number) => {
    const val = parseFloat(editCaixinhaBalance.replace(",", "."));
    if (isNaN(val) || val < 0) {
      setEditingCaixinhaId(null);
      return;
    }
    setSavingCaixinha(true);
    try {
      await fetch(`${API_BASE_URL}/caixinhas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balance: val }),
      });
      setEditingCaixinhaId(null);
      fetchDashboardData();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingCaixinha(false);
    }
  };

  const handleCreateCaixinha = async () => {
    if (!newCaixinhaName.trim()) return;
    const val = parseFloat(newCaixinhaBalance.replace(",", ".")) || 0;
    setSavingCaixinha(true);
    try {
      await fetch(`${API_BASE_URL}/caixinhas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCaixinhaName.trim(),
          balance: val,
          include_in_free_balance: false,
        }),
      });
      setNewCaixinhaName("");
      setNewCaixinhaBalance("");
      setIsCreatingCaixinha(false);
      fetchDashboardData();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingCaixinha(false);
    }
  };

  const handleDeleteCaixinha = async (id: number, name: string) => {
    if (!confirm(`Deseja excluir a caixinha "${name}"?`)) return;
    try {
      await fetch(`${API_BASE_URL}/caixinhas/${id}`, { method: "DELETE" });
      fetchDashboardData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const body: Record<string, string> = { user_name: settingsFormName.trim() };
      if (settingsFormClientId.trim()) body.pluggy_client_id = settingsFormClientId.trim();
      if (settingsFormClientSecret.trim()) body.pluggy_client_secret = settingsFormClientSecret.trim();

      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setUserName(settingsFormName.trim());
        setIsSettingsModalOpen(false);
        fetchDashboardData();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingSettings(false);
    }
  };

  // Salvar categoria de transação
  const handleSaveCategory = async (txId: number) => {
    if (!editCategoryValue.trim()) {
      setEditingTxId(null);
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/transactions/${txId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: editCategoryValue.trim() }),
      });
      if (res.ok) {
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId ? { ...t, category: editCategoryValue.trim() } : t
          )
        );
        setEditingTxId(null);
        const metricsRes = await fetch(`${API_BASE_URL}/metrics`);
        if (metricsRes.ok) {
          setMetrics(await metricsRes.json());
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Toggle Ignorar no Raio-X
  const handleToggleIgnore = async (txId: number, currentlyIgnored?: boolean) => {
    try {
      const nextVal = !currentlyIgnored;
      const res = await fetch(`${API_BASE_URL}/transactions/${txId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_ignored: nextVal }),
      });
      if (res.ok) {
        setTransactions((prev) =>
          prev.map((t) => (t.id === txId ? { ...t, is_ignored: nextVal } : t))
        );
        const metricsRes = await fetch(`${API_BASE_URL}/metrics`);
        if (metricsRes.ok) {
          setMetrics(await metricsRes.json());
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Exportar CSV
  const handleExportCSV = () => {
    if (!transactions.length) return;
    const headers = ["Data", "Estabelecimento", "Categoria", "Tipo", "Valor", "Ignorado"];
    const rows = transactions.map((t) => [
      formatDate(t.date),
      `"${(t.merchant_name || t.description).replace(/"/g, '""')}"`,
      `"${t.category || "Outros"}"`,
      t.type,
      String(t.amount),
      t.is_ignored ? "Sim" : "Não",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `extrato-inteligente-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const proj = metrics.salary_projection;
  const freeBalance = proj?.free_balance ?? 0;
  const freeParts = splitCurrencyParts(freeBalance);
  const commitmentPct = Math.min(100, Math.max(0, proj?.commitment_percentage ?? 0));
  const freePct = Math.max(0, Number((100 - commitmentPct).toFixed(1)));

  // Simulador "Cabe no meu bolso?"
  const simulatedSpend = useMemo(() => {
    const clean = simulatorInput.replace(/[^\d.,]/g, "").replace(",", ".");
    const val = parseFloat(clean);
    if (isNaN(val) || val <= 0) return null;
    const remaining = freeBalance - val;
    const newDaily = Math.max(0, remaining / 30);
    return {
      spend: val,
      remaining,
      newDaily,
      fits: remaining >= 0,
    };
  }, [simulatorInput, freeBalance]);

  // Filtro de Contas Fixas
  const filteredBills = useMemo(() => {
    const list = recurringSummary?.items || [];
    return list.filter((b) => {
      const matchesSearch =
        !billSearchQuery.trim() ||
        b.name.toLowerCase().includes(billSearchQuery.toLowerCase()) ||
        b.category.toLowerCase().includes(billSearchQuery.toLowerCase());
      const matchesCat =
        billCategoryFilter === "Todas" ||
        b.category.toLowerCase() === billCategoryFilter.toLowerCase();
      return matchesSearch && matchesCat;
    });
  }, [recurringSummary, billSearchQuery, billCategoryFilter]);

  const currentMonthName = useMemo(() => {
    const months = [
      "janeiro",
      "fevereiro",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro",
    ];
    const now = new Date();
    return months[now.getMonth()];
  }, []);

  const currentMonthShort = useMemo(() => {
    const months = [
      "JAN",
      "FEV",
      "MAR",
      "ABR",
      "MAI",
      "JUN",
      "JUL",
      "AGO",
      "SET",
      "OUT",
      "NOV",
      "DEZ",
    ];
    return months[new Date().getMonth()];
  }, []);

  // Resolução dinâmica das contas conectadas (Mercado Pago, etc.)
  const creditAccount = useMemo(
    () => metrics.accounts.find((a) => a.type === "CREDIT"),
    [metrics.accounts]
  );
  const bankAccount = useMemo(
    () => metrics.accounts.find((a) => a.type === "BANK"),
    [metrics.accounts]
  );
  const bankAccounts = useMemo(
    () => metrics.accounts.filter((a) => a.type === "BANK"),
    [metrics.accounts]
  );
  const creditAccounts = useMemo(
    () => metrics.accounts.filter((a) => a.type === "CREDIT"),
    [metrics.accounts]
  );

  const creditAccountName = creditAccount?.name || "Cartão de Crédito";
  const bankAccountName = bankAccount?.name || "Conta Corrente";

  // Categorias dinâmicas para o filtro de contas fixas
  const availableBillCategories = useMemo(() => {
    const cats = new Set<string>();
    cats.add("Todas");
    (recurringSummary?.items || []).forEach((b) => {
      if (b.category && b.category.trim()) {
        cats.add(b.category.trim());
      }
    });
    return Array.from(cats);
  }, [recurringSummary]);

  // Total de despesas categorizadas para o centro do Donut Chart
  const totalCategoryExpenses = useMemo(() => {
    return metrics.expenses_by_category.reduce((acc, c) => acc + c.total, 0);
  }, [metrics.expenses_by_category]);

  // Soma entradas e saídas da página atual do extrato
  const pageTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of transactions) {
      if (tx.is_ignored) continue;
      if (tx.type === "CREDIT") income += Number(tx.amount);
      else expense += Number(tx.amount);
    }
    return { income, expense };
  }, [transactions]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans antialiased">
      {/* ========================================================================= */}
      {/* TOP BAR & NAVEGAÇÃO ESTILO FIGMA (NEXO FINANÇAS)                          */}
      {/* ========================================================================= */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          {/* Linha Superior: Brand + Controles Globais */}
          <div className="flex items-center justify-between h-16 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-slate-950 text-white flex items-center justify-center font-bold text-base shadow-xs">
                N
              </div>
              <div>
                <span className="font-bold text-slate-900 text-sm tracking-tight block leading-none">
                  Nexo
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 block mt-1">
                  FINANÇAS PESSOAIS
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Status Open Finance / Botão Conectar */}
              {pluggyConfigured ? (
                <a
                  href="/connect"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Gerenciar conexão Open Finance (Pluggy)"
                  className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/70 hover:bg-emerald-100/70 transition"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Open Finance ativo</span>
                </a>
              ) : (
                <button
                  onClick={() => setIsSettingsModalOpen(true)}
                  title="Configurar chaves da Pluggy e conectar seu banco"
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 transition shadow-2xs animate-pulse"
                >
                  <span>🔌</span>
                  <span>Conectar Banco</span>
                </button>
              )}

              {/* Botão Sincronizar */}
              <button
                onClick={handleSync}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition shadow-2xs disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 text-slate-500 ${
                    syncing ? "animate-spin" : ""
                  }`}
                />
                <span>{syncing ? "Sincronizando..." : "Sincronizar"}</span>
              </button>

              {/* Botão Configurações */}
              <button
                onClick={() => setIsSettingsModalOpen(true)}
                title="Configurações do sistema"
                className="p-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition shadow-2xs"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>

              {/* CTA Planejar um gasto */}
              <button
                onClick={() => {
                  setActiveTab("overview");
                  setTimeout(() => {
                    document
                      .getElementById("simulator-input")
                      ?.focus();
                  }, 100);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white transition shadow-xs"
              >
                <Target className="h-3.5 w-3.5" />
                <span>Planejar um gasto</span>
              </button>
            </div>
          </div>

          {/* Linha Inferior: Abas de Navegação com Sublinhado Ativo */}
          <nav className="flex items-center gap-6 -mb-px overflow-x-auto">
            <button
              onClick={() => setActiveTab("overview")}
              className={`inline-flex items-center gap-2 py-3.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === "overview"
                  ? "border-slate-950 text-slate-950"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Home className="h-3.5 w-3.5" />
              <span>Meu dinheiro</span>
            </button>

            <button
              onClick={() => setActiveTab("recurring")}
              className={`inline-flex items-center gap-2 py-3.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === "recurring"
                  ? "border-slate-950 text-slate-950"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Receipt className="h-3.5 w-3.5" />
              <span>Contas Fixas</span>
              {recurringSummary && recurringSummary.items.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-slate-100 text-slate-600 font-bold">
                  {recurringSummary.items.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("transactions")}
              className={`inline-flex items-center gap-2 py-3.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === "transactions"
                  ? "border-slate-950 text-slate-950"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Movimentações</span>
            </button>

            <button
              onClick={() => setActiveTab("goals")}
              className={`inline-flex items-center gap-2 py-3.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                activeTab === "goals"
                  ? "border-slate-950 text-slate-950"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Target className="h-3.5 w-3.5" />
              <span>Metas</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Container Principal */}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {/* Feedback Toast / Banner */}
        {feedback && (
          <div
            className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs font-medium ${
              feedback.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {feedback.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              )}
              <span>{feedback.message}</span>
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="p-1 hover:bg-black/5 rounded-lg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* ===================================================================== */}
        {/* ABA 1: MEU DINHEIRO (OVERVIEW & RAIO-X HUMANIZADO)                    */}
        {/* ===================================================================== */}
        {activeTab === "overview" && proj && (
          <div className="space-y-6">
            {/* Saudação Humanizada */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  SEU DINHEIRO, SEM COMPLICAÇÃO
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <h1 className="text-3xl font-extrabold tracking-tight text-slate-950">
                    Tudo sob controle{userName ? `, ${userName}` : ""}.
                  </h1>
                  <button
                    onClick={() => setIsSettingsModalOpen(true)}
                    className="p-1 text-slate-300 hover:text-slate-600 rounded-md transition"
                    title="Alterar seu nome ou credenciais"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  Primeiro as contas. Depois, seus planos.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsCardModalOpen(true)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-medium bg-white border border-slate-200/90 text-slate-600 hover:bg-slate-50 shadow-2xs transition"
                >
                  <Calendar className="h-3.5 w-3.5 text-slate-400" />
                  <span>
                    Seu planejamento de {currentMonthName} • Fecha dia{" "}
                    {String(proj.bill_closing_day).padStart(2, "0")}
                  </span>
                </button>
              </div>
            </div>

            {/* HERO GRID: "Livre depois das contas" (7 cols) + "A conta é simples" (5 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* CARD ESQUERDO: LIVRE DEPOIS DAS CONTAS */}
              <div
                className={`lg:col-span-7 rounded-2xl border overflow-hidden flex flex-col justify-between shadow-2xs transition ${
                  freeBalance < 0
                    ? "border-rose-300 bg-gradient-to-b from-rose-50/70 to-white"
                    : "border-emerald-300/80 bg-gradient-to-b from-emerald-50/70 via-emerald-50/30 to-white"
                }`}
              >
                <div className="p-6 sm:p-7 space-y-5">
                  {/* Topo do Card */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Wallet
                        className={`h-4 w-4 ${
                          freeBalance < 0 ? "text-rose-700" : "text-emerald-800"
                        }`}
                      />
                      <span
                        className={`text-xs font-bold ${
                          freeBalance < 0 ? "text-rose-900" : "text-emerald-900"
                        }`}
                      >
                        Livre depois das contas
                      </span>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                        freeBalance < 0
                          ? "bg-white/90 text-rose-700 border-rose-200"
                          : "bg-white/90 text-emerald-700 border-emerald-200"
                      }`}
                    >
                      Seu valor real
                    </span>
                  </div>

                  {/* Valor Principal Gigante com Centavos Menores */}
                  <div>
                    <div
                      className={`flex items-baseline tracking-tight font-extrabold ${
                        freeBalance < 0 ? "text-rose-700" : "text-emerald-800"
                      }`}
                    >
                      <span className="text-4xl sm:text-5xl">
                        {freeParts.prefix}
                        {freeParts.integerPart}
                      </span>
                      <span className="text-2xl sm:text-3xl font-bold">
                        {freeParts.centsPart}
                      </span>
                    </div>
                    <p
                      className={`text-sm mt-2 max-w-md leading-relaxed ${
                        freeBalance < 0
                          ? "text-rose-800/80"
                          : "text-emerald-900/75"
                      }`}
                    >
                      É o que sobra no planejamento após reservar o dinheiro da
                      fatura e das contas fixas.
                    </p>
                  </div>

                  {/* Divisor Sutil */}
                  <div
                    className={`border-t ${
                      freeBalance < 0
                        ? "border-rose-200/60"
                        : "border-emerald-200/60"
                    }`}
                  />

                  {/* Referência Diária */}
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`h-10 w-10 rounded-xl bg-white border flex items-center justify-center shrink-0 shadow-2xs ${
                        freeBalance < 0
                          ? "border-rose-100 text-rose-600"
                          : "border-emerald-100 text-emerald-700"
                      }`}
                    >
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">
                        Uma referência: {formatCurrency(proj.daily_budget)} por
                        dia
                      </p>
                      <p
                        className={`text-xs ${
                          freeBalance < 0
                            ? "text-rose-700/80"
                            : "text-emerald-700/80"
                        }`}
                      >
                        {proj.days_remaining && proj.days_remaining > 0
                          ? `Para os próximos ${proj.days_remaining} dias até o fechamento da fatura.`
                          : "Distribuído até o fechamento da fatura."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Rodapé de Alerta Empático */}
                <div className="bg-white/95 border-t border-slate-100 px-6 py-3.5 flex items-start gap-2.5">
                  <Clock className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {freeBalance < 0 ? (
                      <>
                        <strong className="font-semibold text-slate-900">
                          Atenção ao limite do mês.
                        </strong>{" "}
                        Suas contas superam a renda prevista em{" "}
                        {formatCurrency(Math.abs(freeBalance))}. Evite novos
                        parcelamentos.
                      </>
                    ) : commitmentPct >= 80 ? (
                      <>
                        <strong className="font-semibold text-slate-900">
                          Vá com calma nas próximas compras.
                        </strong>{" "}
                        Quase toda a renda já tem destino. Esse valor é uma
                        previsão, não o saldo do banco.
                      </>
                    ) : (
                      <>
                        <strong className="font-semibold text-slate-900">
                          Planejamento equilibrado.
                        </strong>{" "}
                        Suas contas fixas e cartão estão dentro de uma margem
                        segura da sua renda.
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* CARD DIREITO: A CONTA É SIMPLES */}
              <div className="lg:col-span-5 rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-7 flex flex-col justify-between shadow-2xs">
                <div className="space-y-5">
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calculator className="h-4 w-4 text-slate-700" />
                        <h2 className="text-sm font-bold text-slate-900">
                          A conta é simples
                        </h2>
                      </div>
                      <button
                        onClick={() => setIsCardModalOpen(true)}
                        className="text-[11px] font-semibold text-slate-400 hover:text-slate-700 transition inline-flex items-center gap-1"
                        title="Configurar fatura e ciclo"
                      >
                        <SlidersHorizontal className="h-3 w-3" />
                        <span>Ajustar fatura</span>
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Entenda de onde vem o dinheiro livre.
                    </p>
                  </div>

                  {/* As 3 Linhas da Equação */}
                  <div className="space-y-4">
                    {/* Linha 1: Saldo inicial + salário + Caixinhas CDI */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-600 shrink-0">
                          <Wallet className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold text-slate-800">
                              Saldo inicial + salário
                            </p>
                            <button
                              onClick={() => setIsCaixinhaModalOpen(true)}
                              className="text-[10px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/60 px-2 py-0.5 rounded-md transition inline-flex items-center gap-1"
                              title="Configurar caixinhas de rendimento CDI e metas"
                            >
                              <PiggyBank className="h-3 w-3" />
                              <span>Caixinhas</span>
                              {proj.caixinhas_liquid_total > 0 && (
                                <span className="font-extrabold text-indigo-800">
                                  (+{formatCurrency(proj.caixinhas_liquid_total)})
                                </span>
                              )}
                            </button>
                          </div>
                          {isEditingSalary ? (
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-[11px] text-slate-400">
                                Salário R$
                              </span>
                              <input
                                type="number"
                                value={salaryInput}
                                onChange={(e) => setSalaryInput(e.target.value)}
                                className="w-20 px-1.5 py-0.5 text-xs border border-slate-300 rounded font-bold text-slate-900"
                                autoFocus
                              />
                              <button
                                onClick={handleSaveSalary}
                                disabled={savingSalary}
                                className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setIsEditingSalary(false)}
                                className="p-0.5 text-slate-400 hover:bg-slate-100 rounded"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                              <span>
                                Conta {formatCurrency(proj.bank_balance)}
                                {proj.caixinhas_liquid_total > 0 && (
                                  <> + Caixinha {formatCurrency(proj.caixinhas_liquid_total)}</>
                                )}
                                {" "}+ Salário {formatCurrency(proj.salary)}
                              </span>
                              <button
                                onClick={() => setIsEditingSalary(true)}
                                className="text-slate-400 hover:text-slate-700 underline decoration-dotted"
                                title="Editar salário previsto"
                              >
                                editar
                              </button>
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="text-xs font-bold text-slate-900 tabular-nums">
                        {formatCurrency(proj.total_available)}
                      </span>
                    </div>

                    {/* Linha 2: Fatura do cartão */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-600 shrink-0">
                          <CreditCard className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-800">
                            Fatura do cartão
                          </p>
                          <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                            <span>
                              {creditAccountName}{" "}
                              {proj.is_bill_custom ? "(Manual)" : "(Automático)"}
                            </span>
                            <button
                              onClick={() => setIsCardModalOpen(true)}
                              className="text-slate-400 hover:text-slate-700 underline decoration-dotted"
                            >
                              editar
                            </button>
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-slate-900 tabular-nums">
                        - {formatCurrency(proj.current_bill)}
                      </span>
                    </div>

                    {/* Linha 3: Contas fixas reservadas */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center justify-center text-slate-600 shrink-0">
                          <Home className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-800">
                            Contas fixas pendentes
                          </p>
                          <button
                            onClick={() => setActiveTab("recurring")}
                            className="text-[11px] text-slate-400 hover:text-slate-700 transition text-left"
                          >
                            {proj.recurring_bills_pending === 0 && (proj.recurring_bills_total || 0) > 0
                              ? "Todas as contas pagas no mês"
                              : "Planejamento mensal • ver lista"}
                          </button>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-slate-900 tabular-nums">
                        - {formatCurrency(proj.recurring_bills_pending ?? proj.recurring_bills_total ?? 0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Rodapé: Sobra para você + Barra Bicolor */}
                <div className="pt-5 mt-5 border-t border-slate-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">
                      Sobra para você
                    </span>
                    <span
                      className={`text-base font-extrabold tabular-nums ${
                        freeBalance < 0 ? "text-rose-600" : "text-emerald-700"
                      }`}
                    >
                      {formatCurrency(freeBalance)}
                    </span>
                  </div>

                  {/* Barra de Progresso Bicolor estilo Figma */}
                  <div className="h-2 w-full rounded-full bg-emerald-200 overflow-hidden flex">
                    <div
                      className="h-full bg-slate-800 transition-all duration-500"
                      style={{ width: `${commitmentPct}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
                    <span>{commitmentPct.toFixed(1).replace(".", ",")}% comprometido</span>
                    <span>{freePct.toFixed(1).replace(".", ",")}% livre</span>
                  </div>
                </div>
              </div>
            </div>

            {/* SEGUNDA LINHA: "O que vem pela frente" (7 cols) + "Cabe no meu bolso?" (5 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* O QUE VEM PELA FRENTE */}
              <div className="lg:col-span-7 rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-2xs space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      O que vem pela frente
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Seus próximos vencimentos, em ordem.
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveTab("recurring")}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-950 transition"
                  >
                    <span>Ver contas</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Lista de Vencimentos */}
                <div className="divide-y divide-slate-100">
                  {/* Fatura do Cartão sempre visível como compromisso principal */}
                  <div className="py-3.5 first:pt-0 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <div className="h-11 w-11 rounded-xl bg-amber-50 border border-amber-200/70 flex flex-col items-center justify-center shrink-0">
                        <span className="text-xs font-extrabold text-amber-800 leading-none">
                          {proj.bill_due_date
                            ? proj.bill_due_date.slice(0, 2)
                            : String(proj.bill_due_day).padStart(2, "0")}
                        </span>
                        <span className="text-[9px] font-bold uppercase text-amber-600 mt-0.5">
                          {proj.bill_due_date
                            ? new Date(2000, Number(proj.bill_due_date.slice(3, 5)) - 1, 1)
                                .toLocaleDateString("pt-BR", { month: "short" })
                                .replace(".", "")
                            : currentMonthShort}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-900">
                          Fatura Cartão {creditAccountName}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {proj.bill_status === "CLOSED" ? "Fatura fechada" : "Fatura aberta"} •
                          Compras de {proj.bill_cycle_start} a {proj.bill_cycle_end}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-slate-900 tabular-nums">
                      {formatCurrency(proj.current_bill)}
                    </span>
                  </div>

                  {/* Contas Fixas Cadastradas */}
                  {recurringSummary?.items.map((bill) => (
                    <div
                      key={bill.id}
                      className="py-3.5 flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3.5">
                        <div
                          className={`h-11 w-11 rounded-xl border flex flex-col items-center justify-center shrink-0 ${
                            bill.is_paid_this_month
                              ? "bg-emerald-50 border-emerald-200/70 text-emerald-700"
                              : "bg-slate-50 border-slate-200/80 text-slate-700"
                          }`}
                        >
                          <span className="text-xs font-extrabold leading-none">
                            {String(bill.due_day).padStart(2, "0")}
                          </span>
                          <span className="text-[9px] font-bold uppercase text-slate-400 mt-0.5">
                            {currentMonthShort}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p
                              className={`text-xs font-bold ${
                                bill.is_paid_this_month
                                  ? "line-through text-slate-400"
                                  : "text-slate-900"
                              }`}
                            >
                              {bill.name}
                            </p>
                            {bill.is_paid_this_month && (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 rounded">
                                Pago
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {bill.category} • Todo dia {bill.due_day}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-slate-900 tabular-nums">
                        {formatCurrency(bill.amount)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Nota Explicativa Tranquilizadora */}
                <div className="rounded-xl bg-slate-50 border border-slate-200/60 px-4 py-3 text-xs text-slate-500">
                  <strong className="font-semibold text-slate-700">
                    Já consideradas no planejamento.
                  </strong>{" "}
                  Você não precisa descontar essas contas de novo.
                </div>
              </div>

              {/* COLUNA DIREITA: SIMULADOR "CABE NO MEU BOLSO?" + CARD HÁBITO */}
              <div className="lg:col-span-5 space-y-5">
                {/* Simulador Cabe no meu bolso? */}
                <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs space-y-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-slate-700" />
                      <h2 className="text-sm font-bold text-slate-900">
                        Cabe no meu bolso?
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Teste uma compra antes de decidir. Nada será lançado.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="simulator-input"
                      className="text-xs font-semibold text-slate-700 block"
                    >
                      Quanto você pretende gastar?
                    </label>
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="simulator-input"
                        type="text"
                        value={simulatorInput}
                        onChange={(e) => setSimulatorInput(e.target.value)}
                        placeholder="Valor em R$ • ex.: 50,00"
                        className="w-full pl-9 pr-8 py-2.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition"
                      />
                      {simulatorInput && (
                        <button
                          onClick={() => setSimulatorInput("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Resposta Dinâmica do Simulador */}
                  {!simulatedSpend ? (
                    <div className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5 text-xs text-slate-500">
                      Seu ponto de partida é{" "}
                      <strong className="font-semibold text-slate-700">
                        {formatCurrency(freeBalance)} livres
                      </strong>
                      .
                    </div>
                  ) : simulatedSpend.fits ? (
                    <div className="rounded-xl bg-emerald-50/90 border border-emerald-200 px-3.5 py-3 text-xs text-emerald-900 space-y-1">
                      <p className="font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span>Cabe no seu orçamento livre!</span>
                      </p>
                      <p className="text-emerald-800/90 leading-relaxed">
                        Após gastar{" "}
                        <strong>{formatCurrency(simulatedSpend.spend)}</strong>,
                        ainda restarão{" "}
                        <strong>
                          {formatCurrency(simulatedSpend.remaining)}
                        </strong>{" "}
                        livres ({formatCurrency(simulatedSpend.newDaily)}/dia).
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-3 text-xs text-rose-900 space-y-1">
                      <p className="font-bold flex items-center gap-1.5">
                        <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                        <span>Passa do limite disponível!</span>
                      </p>
                      <p className="text-rose-800/90 leading-relaxed">
                        Essa compra excede seu valor livre em{" "}
                        <strong>
                          {formatCurrency(Math.abs(simulatedSpend.remaining))}
                        </strong>
                        . Se possível, deixe para o próximo ciclo.
                      </p>
                    </div>
                  )}
                </div>

                {/* Card: Um pequeno hábito, mais clareza */}
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5 flex flex-col justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Sparkles className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-xs font-bold text-slate-900">
                        Um pequeno hábito, mais clareza
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Revise suas movimentações para entender seus gastos.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab("transactions")}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 hover:text-indigo-700 transition pl-6"
                  >
                    <span>Revisar movimentações</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* TERCEIRA LINHA: "PARA ONDE FOI A FATURA" (GRÁFICO DONUT + CATEGORIAS) */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-2xs space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Para onde foi a fatura
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Visão visual e detalhada dos gastos por categoria no período.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab("transactions")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-950 transition"
                >
                  <span>Ver todas movimentações</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>

              {metrics.expenses_by_category.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">
                  Nenhuma despesa categorizada encontrada neste ciclo.
                </p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                  {/* Lado Esquerdo: Gráfico Donut (Recharts) */}
                  <div className="lg:col-span-5 flex flex-col items-center justify-center relative py-2">
                    <div className="w-full h-56 relative flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={metrics.expenses_by_category}
                            dataKey="total"
                            nameKey="category"
                            cx="50%"
                            cy="50%"
                            innerRadius={58}
                            outerRadius={82}
                            paddingAngle={3}
                            stroke="none"
                          >
                            {metrics.expenses_by_category.map((_, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={
                                  CATEGORY_BAR_COLORS[
                                    index % CATEGORY_BAR_COLORS.length
                                  ]
                                }
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: any) => [
                              formatCurrency(Number(value)),
                              "Gasto",
                            ]}
                            contentStyle={{
                              backgroundColor: "#0f172a",
                              borderRadius: "0.75rem",
                              border: "none",
                              color: "#fff",
                              fontSize: "12px",
                              boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
                            }}
                            itemStyle={{ color: "#f8fafc" }}
                          />
                        </PieChart>
                      </ResponsiveContainer>

                      {/* Texto Central no miolo do Donut */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                          Total
                        </span>
                        <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                          {formatCurrency(totalCategoryExpenses)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Lado Direito: Lista de Categorias com Valores e Barras */}
                  <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {metrics.expenses_by_category.map((cat, idx) => {
                      const pct =
                        totalCategoryExpenses > 0
                          ? Math.round(
                              (cat.total / totalCategoryExpenses) * 100
                            )
                          : 0;
                      const color =
                        CATEGORY_BAR_COLORS[idx % CATEGORY_BAR_COLORS.length];

                      return (
                        <div
                          key={cat.category}
                          className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 space-y-2 hover:bg-slate-50 transition"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 truncate">
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <span className="font-bold text-slate-800 truncate">
                                {cat.category}
                              </span>
                            </div>
                            <span className="text-slate-400 font-semibold text-[11px]">
                              {pct}%
                            </span>
                          </div>
                          <p className="text-base font-extrabold text-slate-900 tabular-nums">
                            {formatCurrency(cat.total)}
                          </p>
                          <div className="h-1.5 w-full rounded-full bg-slate-200/70 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.max(6, pct)}%`,
                                backgroundColor: color,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* ABA 2: CONTAS FIXAS (IDÊNTICO AO PRINT 3 DO FIGMA)                    */}
        {/* ===================================================================== */}
        {activeTab === "recurring" && (
          <div className="space-y-6">
            {/* Cabeçalho da Aba */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  PLANEJAMENTO MENSAL
                </p>
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 mt-1">
                  Contas Fixas
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  Organize os compromissos que se repetem todos os meses.
                </p>
              </div>
              <button
                onClick={handleOpenNewBill}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-950 hover:bg-slate-800 text-white shadow-xs transition self-start sm:self-auto"
              >
                <Plus className="h-4 w-4" />
                <span>Adicionar Conta</span>
              </button>
            </div>

            {/* 3 KPI Cards: Total mensal, Pendente, Pago */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Total Mensal */}
              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 flex items-center gap-4 shadow-2xs">
                <div className="h-11 w-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <Receipt className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">
                    Total mensal
                  </p>
                  <p className="text-2xl font-extrabold text-slate-900 tabular-nums mt-0.5">
                    {formatCurrency(recurringSummary?.total_monthly || 0)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {recurringSummary?.items.length || 0} conta(s) recorrente(s)
                  </p>
                </div>
              </div>

              {/* Pendente */}
              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 flex items-center gap-4 shadow-2xs">
                <div className="h-11 w-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">Pendente</p>
                  <p className="text-2xl font-extrabold text-slate-900 tabular-nums mt-0.5">
                    {formatCurrency(recurringSummary?.total_pending || 0)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {recurringSummary?.items.filter((i) => !i.is_paid_this_month)
                      .length || 0}{" "}
                    vencimento(s) próximo(s)
                  </p>
                </div>
              </div>

              {/* Pago */}
              <div className="rounded-2xl border border-slate-200/90 bg-white p-5 flex items-center gap-4 shadow-2xs">
                <div className="h-11 w-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">Pago</p>
                  <p className="text-2xl font-extrabold text-slate-900 tabular-nums mt-0.5">
                    {formatCurrency(recurringSummary?.total_paid || 0)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {recurringSummary && recurringSummary.total_monthly > 0
                      ? `${Math.round(
                          (recurringSummary.total_paid /
                            recurringSummary.total_monthly) *
                            100
                        )}% do total`
                      : "0% do total"}
                  </p>
                </div>
              </div>
            </div>

            {/* Card da Tabela com Busca e Filtros */}
            <div className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
              {/* Barra de Busca e Pills */}
              <div className="p-4 sm:px-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={billSearchQuery}
                    onChange={(e) => setBillSearchQuery(e.target.value)}
                    placeholder="Buscar conta..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition"
                  />
                </div>

                <div className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl overflow-x-auto">
                  {availableBillCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setBillCategoryFilter(cat)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                        billCategoryFilter === cat
                          ? "bg-white text-slate-900 shadow-2xs"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tabela de Contas Fixas */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-3.5 pl-6 pr-2 w-10"></th>
                      <th className="py-3.5 px-4">NOME</th>
                      <th className="py-3.5 px-4">CATEGORIA</th>
                      <th className="py-3.5 px-4">VENCIMENTO</th>
                      <th className="py-3.5 px-4 text-right">VALOR</th>
                      <th className="py-3.5 pl-2 pr-6 text-right w-24">AÇÕES</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredBills.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-12 text-center text-slate-400"
                        >
                          Nenhuma conta fixa encontrada. Clique em &ldquo;+
                          Adicionar Conta&rdquo; para cadastrar.
                        </td>
                      </tr>
                    ) : (
                      filteredBills.map((bill) => {
                        const paid = bill.is_paid_this_month;
                        return (
                          <tr
                            key={bill.id}
                            className={`group transition ${
                              paid ? "bg-slate-50/40" : "hover:bg-slate-50/60"
                            }`}
                          >
                            {/* Checkbox Verde Estilo Figma */}
                            <td className="py-4 pl-6 pr-2">
                              <button
                                onClick={() => handleTogglePaidBill(bill.id)}
                                title={
                                  paid
                                    ? "Desmarcar pagamento deste mês"
                                    : "Marcar como paga neste mês"
                                }
                                className={`h-5 w-5 rounded-md border flex items-center justify-center transition ${
                                  paid
                                    ? "bg-emerald-600 border-emerald-600 text-white"
                                    : "bg-white border-slate-300 hover:border-slate-400"
                                }`}
                              >
                                {paid && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                              </button>
                            </td>

                            {/* Nome + Ícone */}
                            <td className="py-4 px-4">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                                    paid
                                      ? "bg-emerald-50 text-emerald-600"
                                      : "bg-indigo-50/70 text-indigo-600"
                                  }`}
                                >
                                  <Home className="h-4 w-4" />
                                </div>
                                <div>
                                  <p
                                    className={`font-bold ${
                                      paid
                                        ? "text-slate-400 line-through"
                                        : "text-slate-900"
                                    }`}
                                  >
                                    {bill.name}
                                  </p>
                                  <p className="text-[11px] text-slate-400">
                                    Mensal
                                  </p>
                                </div>
                              </div>
                            </td>

                            {/* Categoria Pill */}
                            <td className="py-4 px-4">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${getCategoryBadgeStyle(
                                  bill.category
                                )}`}
                              >
                                {bill.category}
                              </span>
                            </td>

                            {/* Vencimento */}
                            <td className="py-4 px-4 text-slate-600 font-medium">
                              <div className="inline-flex items-center gap-1.5">
                                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                                <span>
                                  {String(bill.due_day).padStart(2, "0")}{" "}
                                  {currentMonthName.slice(0, 3)}
                                </span>
                              </div>
                            </td>

                            {/* Valor */}
                            <td className="py-4 px-4 text-right font-extrabold text-slate-900 tabular-nums">
                              {formatCurrency(bill.amount)}
                            </td>

                            {/* Ações */}
                            <td className="py-4 pl-2 pr-6 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  onClick={() => handleOpenEditBill(bill)}
                                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                                  title="Editar conta fixa"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() =>
                                    handleDeleteBill(bill.id, bill.name)
                                  }
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                  title="Excluir conta fixa"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Rodapé da Tabela */}
              <div className="px-6 py-3.5 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-medium">
                <span>
                  {filteredBills.length} de{" "}
                  {recurringSummary?.items.length || 0} contas
                </span>
                <span>Atualizado agora</span>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* ABA 3: MOVIMENTAÇÕES / EXTRATO INTELIGENTE (IDÊNTICO AO PRINT 4)       */}
        {/* ===================================================================== */}
        {activeTab === "transactions" && (
          <div className="space-y-6">
            {/* Cabeçalho */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  {(creditAccountName || "CARTÃO").toUpperCase()} & {(bankAccountName || "CONTA").toUpperCase()} • {currentMonthName.toUpperCase()}
                </p>
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 mt-1">
                  Extrato Inteligente
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  Movimentações organizadas automaticamente para você revisar.
                </p>
              </div>

              <button
                onClick={handleExportCSV}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-2xs transition self-start sm:self-auto"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Exportar CSV</span>
              </button>
            </div>

            {/* Dashboard / Resumo Financeiro Rápido do Extrato */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Fatura Aberta do Cartão */}
              <div
                onClick={() => {
                  if (creditAccount) {
                    if (selectedAccountId === creditAccount.id && period === "current_month") {
                      setSelectedAccountId(null);
                    } else {
                      setSelectedAccountId(creditAccount.id);
                      setPeriod("current_month");
                    }
                    setCurrentPage(1);
                  }
                }}
                className={`p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                  selectedAccountId === creditAccount?.id && period === "current_month"
                    ? "bg-slate-900 border-slate-900 text-white shadow-sm"
                    : "bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                      selectedAccountId === creditAccount?.id && period === "current_month"
                        ? "bg-white/10 text-white"
                        : "bg-indigo-50 text-indigo-600 border border-indigo-100"
                    }`}
                  >
                    <CreditCard className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        selectedAccountId === creditAccount?.id && period === "current_month"
                          ? "bg-white/20 text-white"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {proj?.is_bill_custom
                        ? "Manual"
                        : proj?.bill_status === "CLOSED"
                        ? "Fechada"
                        : "Ciclo atual"}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsCardModalOpen(true);
                      }}
                      title="Configurar datas e valor da fatura"
                      className={`p-1 rounded-lg transition ${
                        selectedAccountId === creditAccount?.id && period === "current_month"
                          ? "text-slate-300 hover:text-white hover:bg-white/10"
                          : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <p
                    className={`text-xs font-semibold ${
                      selectedAccountId === creditAccount?.id && period === "current_month"
                        ? "text-slate-300"
                        : "text-slate-500"
                    }`}
                  >
                    {proj?.bill_status === "CLOSED" ? "Fatura Fechada" : "Fatura Aberta"} ({creditAccountName})
                  </p>
                  <p
                    className={`text-xl font-black tracking-tight tabular-nums mt-0.5 ${
                      selectedAccountId === creditAccount?.id && period === "current_month"
                        ? "text-white"
                        : "text-slate-950"
                    }`}
                  >
                    {formatCurrency(proj?.current_bill ?? 0)}
                  </p>
                </div>

                <div
                  className={`mt-2.5 pt-2 border-t flex items-center justify-between text-[11px] ${
                    selectedAccountId === creditAccount?.id && period === "current_month"
                      ? "border-white/10 text-slate-300"
                      : "border-slate-100 text-slate-400"
                  }`}
                >
                  <span>
                    {proj?.bill_due_date
                      ? `Vence ${proj.bill_due_date}`
                      : `Vence dia ${proj?.bill_due_day ?? 7}`}
                    {proj?.bill_status === "CLOSED" && proj?.bill_open_amount
                      ? ` • Aberta: ${formatCurrency(proj.bill_open_amount)}`
                      : ` • Fecha dia ${proj?.bill_closing_day ?? 2}`}
                  </span>
                  <span className="font-semibold text-indigo-500 group-hover:translate-x-0.5 transition">
                    {selectedAccountId === creditAccount?.id && period === "current_month" ? "Filtrado ✓" : "Filtrar cartão →"}
                  </span>
                </div>
              </div>

              {/* Card 2: Parcelas Futuras */}
              <div
                onClick={() => {
                  if (period === "future") {
                    setPeriod("current_month");
                  } else {
                    setPeriod("future");
                    setSelectedAccountId(null);
                  }
                  setCurrentPage(1);
                }}
                className={`p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                  period === "future"
                    ? "bg-slate-900 border-slate-900 text-white shadow-sm"
                    : "bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                      period === "future"
                        ? "bg-white/10 text-white"
                        : "bg-amber-50 text-amber-600 border border-amber-100"
                    }`}
                  >
                    <Clock className="h-4 w-4" />
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      period === "future"
                        ? "bg-white/20 text-white"
                        : "bg-amber-100/60 text-amber-800"
                    }`}
                  >
                    {metrics.future_commitments.length} mês(es)
                  </span>
                </div>

                <div className="mt-3">
                  <p
                    className={`text-xs font-semibold ${
                      period === "future" ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    Parcelas Futuras do Cartão
                  </p>
                  <p
                    className={`text-xl font-black tracking-tight tabular-nums mt-0.5 ${
                      period === "future" ? "text-white" : "text-slate-950"
                    }`}
                  >
                    {formatCurrency(metrics.future_commitments_total)}
                  </p>
                </div>

                <div
                  className={`mt-2.5 pt-2 border-t flex items-center justify-between text-[11px] ${
                    period === "future"
                      ? "border-white/10 text-slate-300"
                      : "border-slate-100 text-slate-400"
                  }`}
                >
                  <span>Compras já programadas</span>
                  <span className="font-semibold text-amber-600 group-hover:translate-x-0.5 transition">
                    {period === "future" ? "Filtrado ✓" : "Ver parcelas →"}
                  </span>
                </div>
              </div>

              {/* Card 3: Despesas Totais do Mês */}
              <div
                onClick={() => {
                  setPeriod("current_month");
                  setSelectedAccountId(null);
                  setCurrentPage(1);
                }}
                className={`p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                  period === "current_month" && selectedAccountId === null
                    ? "bg-slate-900 border-slate-900 text-white shadow-sm"
                    : "bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                      period === "current_month" && selectedAccountId === null
                        ? "bg-white/10 text-white"
                        : "bg-rose-50 text-rose-600 border border-rose-100"
                    }`}
                  >
                    <Receipt className="h-4 w-4" />
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      period === "current_month" && selectedAccountId === null
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    Gastos reais
                  </span>
                </div>

                <div className="mt-3">
                  <p
                    className={`text-xs font-semibold ${
                      period === "current_month" && selectedAccountId === null
                        ? "text-slate-300"
                        : "text-slate-500"
                    }`}
                  >
                    Despesas do Mês Atual
                  </p>
                  <p
                    className={`text-xl font-black tracking-tight tabular-nums mt-0.5 ${
                      period === "current_month" && selectedAccountId === null
                        ? "text-white"
                        : "text-slate-950"
                    }`}
                  >
                    {formatCurrency(metrics.monthly_expenses)}
                  </p>
                </div>

                <div
                  className={`mt-2.5 pt-2 border-t flex items-center justify-between text-[11px] ${
                    period === "current_month" && selectedAccountId === null
                      ? "border-white/10 text-slate-300"
                      : "border-slate-100 text-slate-400"
                  }`}
                >
                  <span>Todas as saídas do mês</span>
                  <span className="font-semibold text-rose-500 group-hover:translate-x-0.5 transition">
                    {period === "current_month" && selectedAccountId === null ? "Filtrado ✓" : "Ver mês →"}
                  </span>
                </div>
              </div>

              {/* Card 4: Saldo Disponível em Contas */}
              <div
                onClick={() => {
                  if (bankAccount) {
                    if (selectedAccountId === bankAccount.id) {
                      setSelectedAccountId(null);
                    } else {
                      setSelectedAccountId(bankAccount.id);
                      setPeriod("current_month");
                    }
                    setCurrentPage(1);
                  }
                }}
                className={`p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                  selectedAccountId === bankAccount?.id
                    ? "bg-slate-900 border-slate-900 text-white shadow-sm"
                    : "bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                      selectedAccountId === bankAccount?.id
                        ? "bg-white/10 text-white"
                        : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                    }`}
                  >
                    <Wallet className="h-4 w-4" />
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      selectedAccountId === bankAccount?.id
                        ? "bg-white/20 text-white"
                        : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {bankAccounts.length} conta(s)
                  </span>
                </div>

                <div className="mt-3">
                  <p
                    className={`text-xs font-semibold ${
                      selectedAccountId === bankAccount?.id ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    Saldo em Conta ({bankAccountName})
                  </p>
                  <p
                    className={`text-xl font-black tracking-tight tabular-nums mt-0.5 ${
                      selectedAccountId === bankAccount?.id ? "text-white" : "text-slate-950"
                    }`}
                  >
                    {formatCurrency(metrics.bank_balance)}
                  </p>
                </div>

                <div
                  className={`mt-2.5 pt-2 border-t flex items-center justify-between text-[11px] ${
                    selectedAccountId === bankAccount?.id
                      ? "border-white/10 text-slate-300"
                      : "border-slate-100 text-slate-400"
                  }`}
                >
                  <span>Saldo à vista disponível</span>
                  <span className="font-semibold text-emerald-600 group-hover:translate-x-0.5 transition">
                    {selectedAccountId === bankAccount?.id ? "Filtrado ✓" : "Filtrar conta →"}
                  </span>
                </div>
              </div>
            </div>

            {/* Card Principal do Extrato */}
            <div className="rounded-2xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
              {/* Barra de Filtros */}
              <div className="p-4 sm:px-6 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
                  {/* Busca */}
                  <div className="relative w-full sm:w-72">
                    <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder="Buscar estabelecimento..."
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 transition"
                    />
                  </div>

                  {/* Seletor de Período */}
                  <div className="inline-flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl">
                    <button
                      onClick={() => {
                        setPeriod("current_month");
                        setCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        period === "current_month"
                          ? "bg-white text-slate-900 shadow-2xs"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Mês atual
                    </button>
                    <button
                      onClick={() => {
                        setPeriod("future");
                        setCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        period === "future"
                          ? "bg-white text-slate-900 shadow-2xs"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Parcelas futuras
                    </button>
                    <button
                      onClick={() => {
                        setPeriod("all");
                        setCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        period === "all"
                          ? "bg-white text-slate-900 shadow-2xs"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Tudo
                    </button>
                  </div>
                </div>

                {/* Filtro de Contas Dinâmico */}
                <div className="inline-flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl self-start md:self-auto">
                  <button
                    onClick={() => {
                      setSelectedAccountId(null);
                      setCurrentPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      selectedAccountId === null
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Todas
                  </button>
                  {metrics.accounts.map((acc) => (
                    <button
                      key={acc.id}
                      onClick={() => {
                        setSelectedAccountId(acc.id);
                        setCurrentPage(1);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                        selectedAccountId === acc.id
                          ? "bg-white text-slate-900 shadow-2xs"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {acc.type === "CREDIT"
                        ? `${acc.name} (Cartão)`
                        : `${acc.name} (Conta)`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Faixa Informativa Roxa/Indigo Estilo Figma */}
              <div className="bg-indigo-50/50 border-y border-indigo-100/80 px-6 py-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-indigo-700 font-semibold">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>
                    Transações categorizadas automaticamente via Open Finance
                  </span>
                </div>
                <span className="text-[11px] text-indigo-600/80 font-medium hidden sm:inline">
                  Clique na categoria para revisar
                </span>
              </div>

              {/* Tabela de Transações */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-3.5 pl-6 pr-4">TRANSAÇÃO</th>
                      <th className="py-3.5 px-4">CATEGORIA</th>
                      <th className="py-3.5 px-4">DETALHES</th>
                      <th className="py-3.5 px-4 text-center">
                        IGNORAR NO RAIO-X
                      </th>
                      <th className="py-3.5 pl-4 pr-6 text-right">VALOR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {transactions.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-12 text-center text-slate-400"
                        >
                          Nenhuma movimentação encontrada para este filtro.
                        </td>
                      </tr>
                    ) : (
                      transactions.map((tx) => {
                        const isCredit = tx.type === "CREDIT";
                        const isFuture = new Date(tx.date) > new Date();
                        const isIgnored = Boolean(tx.is_ignored);
                        const displayName = tx.merchant_name || tx.description;
                        const avatar = getMerchantAvatar(displayName);

                        return (
                          <tr
                            key={tx.id}
                            className={`transition ${
                              isIgnored
                                ? "opacity-45 bg-slate-50/50"
                                : "hover:bg-slate-50/60"
                            }`}
                          >
                            {/* Estabelecimento com Avatar */}
                            <td className="py-4 pl-6 pr-4">
                              <div className="flex items-center gap-3.5">
                                <div
                                  className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${avatar.bg}`}
                                >
                                  {avatar.initials}
                                </div>
                                <div>
                                  <p className="font-bold text-slate-900">
                                    {displayName}
                                  </p>
                                  <p className="text-[11px] text-slate-400 mt-0.5">
                                    {formatDate(tx.date)} •{" "}
                                    {tx.account_name ||
                                      (tx.account_type === "BANK"
                                        ? `${bankAccountName} (Conta)`
                                        : `${creditAccountName} (Cartão)`)}
                                  </p>
                                </div>
                              </div>
                            </td>

                            {/* Categoria Dropdown Inline */}
                            <td className="py-4 px-4">
                              {editingTxId === tx.id ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={editCategoryValue}
                                    onChange={(e) =>
                                      setEditCategoryValue(e.target.value)
                                    }
                                    list="cat-suggestions"
                                    className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white w-32 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                    autoFocus
                                  />
                                  <datalist id="cat-suggestions">
                                    {availableCategories.map((c) => (
                                      <option key={c} value={c} />
                                    ))}
                                  </datalist>
                                  <button
                                    onClick={() => handleSaveCategory(tx.id)}
                                    className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setEditingTxId(null)}
                                    className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    setEditingTxId(tx.id);
                                    setEditCategoryValue(
                                      tx.category || "Outros"
                                    );
                                  }}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition hover:opacity-80 ${getCategoryBadgeStyle(
                                    tx.category
                                  )}`}
                                >
                                  <span>{tx.category || "Outros"}</span>
                                  <ChevronDown className="h-3 w-3 opacity-60" />
                                </button>
                              )}
                            </td>

                            {/* Detalhes / Parcela */}
                            <td className="py-4 px-4">
                              {isFuture ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/70">
                                  <Clock className="h-3 w-3" />
                                  <span>Parcela futura</span>
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>

                            {/* Switch iOS: Ignorar no Raio-X */}
                            <td className="py-4 px-4 text-center">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isIgnored}
                                onClick={() =>
                                  handleToggleIgnore(tx.id, tx.is_ignored)
                                }
                                title={
                                  isIgnored
                                    ? "Ignorado nos cálculos (clique para reativar)"
                                    : "Ativo nos cálculos (clique para ignorar)"
                                }
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                  isIgnored ? "bg-slate-900" : "bg-slate-200"
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                                    isIgnored ? "translate-x-4" : "translate-x-0"
                                  }`}
                                />
                              </button>
                            </td>

                            {/* Valor */}
                            <td
                              className={`py-4 pl-4 pr-6 text-right font-extrabold tabular-nums whitespace-nowrap ${
                                isCredit ? "text-emerald-600" : "text-slate-900"
                              }`}
                            >
                              {isCredit ? "+ " : "- "}
                              {formatCurrency(Number(tx.amount))}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Rodapé do Extrato com Resumo e Paginação */}
              <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-3 text-slate-500">
                  <span>
                    {transactions.length} transações exibidas (total:{" "}
                    {totalCount})
                  </span>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-1.5 ml-2">
                      <button
                        disabled={currentPage <= 1}
                        onClick={() =>
                          setCurrentPage((p) => Math.max(1, p - 1))
                        }
                        className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold disabled:opacity-40 hover:bg-slate-50"
                      >
                        Anterior
                      </button>
                      <span className="text-[11px] font-semibold px-1">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        disabled={currentPage >= totalPages}
                        onClick={() =>
                          setCurrentPage((p) => Math.min(totalPages, p + 1))
                        }
                        className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold disabled:opacity-40 hover:bg-slate-50"
                      >
                        Próxima
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4 font-semibold">
                  <span className="text-slate-500">
                    Entradas{" "}
                    <strong className="text-emerald-600">
                      +{formatCurrency(pageTotals.income)}
                    </strong>
                  </span>
                  <span className="text-slate-500">
                    Saídas{" "}
                    <strong className="text-slate-900">
                      -{formatCurrency(pageTotals.expense)}
                    </strong>
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================== */}
        {/* ABA 4: METAS FINANCEIRAS (IDÊNTICO AO PRINT 5 DO FIGMA)               */}
        {/* ===================================================================== */}
        {activeTab === "goals" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  SEUS PRÓXIMOS PASSOS
                </p>
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 mt-1">
                  Metas
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  Planos concretos para o dinheiro que você ainda vai construir.
                </p>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  onClick={() => setIsCaixinhaModalOpen(true)}
                  className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-2xs transition"
                  title="Configurar caixinhas do Mercado Pago"
                >
                  <PiggyBank className="h-4 w-4 text-amber-500" />
                  <span>Caixinhas</span>
                </button>
                <button
                  onClick={handleOpenNewGoal}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-950 hover:bg-slate-800 text-white shadow-xs transition"
                >
                  <Plus className="h-4 w-4" />
                  <span>Nova Meta</span>
                </button>
              </div>
            </div>

            {goals.length === 0 ? (
              <div className="rounded-2xl border border-slate-200/90 bg-white p-12 text-center shadow-2xs space-y-3">
                <div className="h-12 w-12 rounded-2xl bg-slate-50 text-slate-400 mx-auto flex items-center justify-center">
                  <Target className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Nenhuma meta cadastrada
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                    Crie objetivos para guardar dinheiro (ex: Reserva de emergência, Viagem, etc.) e acompanhe sua evolução.
                  </p>
                </div>
                <button
                  onClick={handleOpenNewGoal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-950 hover:bg-slate-800 text-white shadow-xs transition"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Criar primeira meta</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {goals.map((goal) => {
                  const barColorClass =
                    goal.color === "indigo"
                      ? "bg-indigo-600"
                      : goal.color === "amber"
                      ? "bg-amber-500"
                      : goal.color === "rose"
                      ? "bg-rose-600"
                      : "bg-emerald-600";

                  return (
                    <div
                      key={goal.id}
                      className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs flex flex-col justify-between space-y-6 hover:border-slate-300 transition"
                    >
                      <div className="flex items-center justify-between">
                        <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                          <Target className="h-4 w-4" />
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleOpenEditGoal(goal)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                            title="Editar meta / atualizar saldo guardado"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteGoal(goal.id, goal.name)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            title="Excluir meta"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          {goal.name}
                        </h3>
                        <p className="text-2xl font-extrabold text-slate-950 tabular-nums mt-1">
                          {formatCurrency(goal.current_amount)}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          de {formatCurrency(goal.target_amount)}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${barColorClass}`}
                            style={{
                              width: `${Math.min(100, goal.progress_percentage)}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-end">
                          <span className="text-xs font-bold text-slate-500">
                            {Math.round(goal.progress_percentage)}%
                          </span>
                        </div>
                      </div>

                      {caixinhas.filter((c) => c.linked_goal_id === goal.id).length > 0 && (
                        <div className="pt-2 border-t border-slate-100 flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Caixinha Vinculada
                          </span>
                          {caixinhas
                            .filter((c) => c.linked_goal_id === goal.id)
                            .map((c) => (
                              <div
                                key={c.id}
                                className="flex items-center justify-between text-xs bg-amber-50/70 border border-amber-200/60 rounded-xl px-2.5 py-1.5 text-amber-900"
                              >
                                <span className="flex items-center gap-1.5 font-semibold truncate">
                                  <PiggyBank className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                                  <span className="truncate">{c.name}</span>
                                </span>
                                <span className="font-extrabold shrink-0 text-amber-950">
                                  {formatCurrency(c.balance)}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Rodapé Minimalista */}
        <footer className="pt-6 pb-8 text-center text-[11px] text-slate-400 flex items-center justify-center gap-2">
          <span>
            Nexo Finanças Pessoais • Conectado via Pluggy Open Finance
          </span>
        </footer>
      </main>

      {/* ========================================================================= */}
      {/* MODAL 1: CONFIGURAÇÃO DO CICLO E VALOR DA FATURA                          */}
      {/* ========================================================================= */}
      {isCardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-200 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
                  <SlidersHorizontal className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Configurar Fatura & Ciclo do Cartão
                  </h3>
                  <p className="text-xs text-slate-500">
                    Personalize datas e modo de apuração da fatura
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCardModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Dia de Fechamento:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={closingDayInput}
                    onChange={(e) => setClosingDayInput(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-bold border border-slate-200 rounded-xl"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Dia de Vencimento:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={dueDayInput}
                    onChange={(e) => setDueDayInput(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-bold border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <label className="text-xs font-semibold text-slate-700 block">
                  Valor da Fatura do Mês:
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setBillMode("auto")}
                    className={`p-3 rounded-xl text-xs font-semibold border text-left transition ${
                      billMode === "auto"
                        ? "bg-slate-950 border-slate-950 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Automático</span>
                    </div>
                    <p
                      className={`text-[10px] mt-1 font-normal ${
                        billMode === "auto" ? "text-slate-300" : "text-slate-400"
                      }`}
                    >
                      Calcula pelo extrato sincronizado.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBillMode("custom")}
                    className={`p-3 rounded-xl text-xs font-semibold border text-left transition ${
                      billMode === "custom"
                        ? "bg-slate-950 border-slate-950 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Pencil className="h-3.5 w-3.5" />
                      <span>Definir Manual</span>
                    </div>
                    <p
                      className={`text-[10px] mt-1 font-normal ${
                        billMode === "custom"
                          ? "text-slate-300"
                          : "text-slate-400"
                      }`}
                    >
                      Informar valor exato no app {creditAccountName}.
                    </p>
                  </button>
                </div>

                {billMode === "custom" && (
                  <div className="mt-2 p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                    <label className="text-xs font-semibold text-slate-700 block">
                      Valor Exato da Fatura (R$):
                    </label>
                    <input
                      type="text"
                      value={customBillInput}
                      onChange={(e) => setCustomBillInput(e.target.value)}
                      placeholder={String(proj?.current_bill || "0.00")}
                      className="w-full px-3 py-1.5 text-sm font-bold bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsCardModalOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveCardSettings}
                disabled={savingCardSettings}
                className="px-4 py-2 text-xs font-bold text-white bg-slate-950 hover:bg-slate-800 rounded-xl"
              >
                {savingCardSettings ? "Salvando..." : "Salvar Configurações"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: ADICIONAR / EDITAR CONTA FIXA                                    */}
      {/* ========================================================================= */}
      {isBillModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-200 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
                  <Receipt className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {editingBillItem ? "Editar Conta Fixa" : "Nova Conta Fixa"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Compromisso recorrente descontado no Raio-X
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsBillModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Nome da Conta / Compromisso:
                </label>
                <input
                  type="text"
                  value={billFormName}
                  onChange={(e) => setBillFormName(e.target.value)}
                  placeholder="Ex: Aluguel, Internet, Luz, Assinatura"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Valor Mensal (R$):
                  </label>
                  <input
                    type="text"
                    value={billFormAmount}
                    onChange={(e) => setBillFormAmount(e.target.value)}
                    placeholder="150.00"
                    className="w-full px-3 py-2 text-sm font-bold rounded-xl border border-slate-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Dia de Vencimento:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={billFormDueDay}
                    onChange={(e) => setBillFormDueDay(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-bold rounded-xl border border-slate-200"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Categoria:
                </label>
                <select
                  value={billFormCategory}
                  onChange={(e) => setBillFormCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white"
                >
                  <option value="Família">Família</option>
                  <option value="Moradia">Moradia</option>
                  <option value="Assinaturas">Assinaturas</option>
                  <option value="Serviços">Serviços</option>
                  <option value="Saúde">Saúde</option>
                  <option value="Educação">Educação</option>
                  <option value="Outros">Outros</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsBillModalOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveBill}
                disabled={savingBill || !billFormName.trim()}
                className="px-4 py-2 text-xs font-bold text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-50 rounded-xl"
              >
                {savingBill ? "Salvando..." : "Salvar Conta"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: NOVA / EDITAR META FINANCEIRA                                    */}
      {/* ========================================================================= */}
      {isGoalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-200 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
                  <Target className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {editingGoal ? "Editar Meta" : "Nova Meta Financeira"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Defina o valor objetivo e acompanhe sua evolução
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsGoalModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Nome do Objetivo:
                </label>
                <input
                  type="text"
                  value={goalFormName}
                  onChange={(e) => setGoalFormName(e.target.value)}
                  placeholder="Ex: Reserva de emergência, Viagem, Reforma"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Já Guardado (R$):
                  </label>
                  <input
                    type="text"
                    value={goalFormCurrent}
                    onChange={(e) => setGoalFormCurrent(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm font-bold rounded-xl border border-slate-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Meta Total (R$):
                  </label>
                  <input
                    type="text"
                    value={goalFormTarget}
                    onChange={(e) => setGoalFormTarget(e.target.value)}
                    placeholder="1000.00"
                    className="w-full px-3 py-2 text-sm font-bold rounded-xl border border-slate-200"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Cor da Barra:
                </label>
                <div className="flex items-center gap-2 pt-1">
                  {[
                    { id: "emerald", label: "Verde", cls: "bg-emerald-600" },
                    { id: "indigo", label: "Azul/Roxo", cls: "bg-indigo-600" },
                    { id: "amber", label: "Laranja", cls: "bg-amber-500" },
                    { id: "rose", label: "Rosa", cls: "bg-rose-600" },
                  ].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setGoalFormColor(c.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 ${
                        goalFormColor === c.id
                          ? "border-slate-900 bg-slate-50 font-bold"
                          : "border-slate-200 text-slate-600"
                      }`}
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${c.cls}`} />
                      <span>{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsGoalModalOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveGoal}
                disabled={savingGoal || !goalFormName.trim()}
                className="px-4 py-2 text-xs font-bold text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-50 rounded-xl"
              >
                {savingGoal ? "Salvando..." : "Salvar Meta"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: CAIXINHAS & RESERVAS MERCADO PAGO                                */}
      {/* ========================================================================= */}
      {isCaixinhaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 border border-slate-200 space-y-5 my-8 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
                  <PiggyBank className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Caixinhas & Reservas (Mercado Pago)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Defina onde seu dinheiro guardado atua
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCaixinhaModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Banner explicativo */}
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 space-y-1.5 text-xs text-slate-600">
              <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                <span>💡</span> Como funcionam as duas opções:
              </p>
              <div className="space-y-1 pl-1 text-[11px] leading-relaxed">
                <p>
                  <strong className="text-emerald-700">1. Rendimento CDI (Saldo Livre):</strong>{" "}
                  Soma com o saldo disponível no Raio-X do Salário (ideal para dinheiro parado rendendo que você usa no dia a dia).
                </p>
                <p>
                  <strong className="text-indigo-700">2. Vincular a uma Meta:</strong>{" "}
                  Atualiza o progresso da meta e protege o valor do saldo livre do mês para você não gastar por engano.
                </p>
              </div>
            </div>

            {/* Lista de Caixinhas */}
            <div className="space-y-3 overflow-y-auto flex-1 pr-1 max-h-[420px]">
              {caixinhas.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs">
                  Nenhuma caixinha cadastrada ou detectada.
                </div>
              ) : (
                caixinhas.map((cx) => (
                  <div
                    key={cx.id}
                    className="p-4 rounded-xl border border-slate-200/90 bg-white hover:border-slate-300 transition space-y-3 shadow-2xs"
                  >
                    {/* Linha superior: Nome + Saldo com edição */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-sm text-slate-900 truncate">
                          {cx.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {editingCaixinhaId === cx.id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-400 font-semibold">R$</span>
                            <input
                              type="text"
                              value={editCaixinhaBalance}
                              onChange={(e) => setEditCaixinhaBalance(e.target.value)}
                              className="w-24 px-2 py-1 text-xs font-bold rounded-lg border border-slate-300 focus:outline-slate-900"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveCaixinhaBalance(cx.id)}
                              disabled={savingCaixinha}
                              className="p-1 bg-slate-950 text-white rounded-lg hover:bg-slate-800 transition"
                              title="Salvar saldo"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => setEditingCaixinhaId(null)}
                              className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-extrabold text-slate-950 tabular-nums">
                              {formatCurrency(cx.balance)}
                            </span>
                            <button
                              onClick={() => {
                                setEditingCaixinhaId(cx.id);
                                setEditCaixinhaBalance(cx.balance.toFixed(2));
                              }}
                              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition"
                              title="Editar saldo real da caixinha"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </div>
                        )}

                        <button
                          onClick={() => handleDeleteCaixinha(cx.id, cx.name)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition ml-1"
                          title="Excluir caixinha"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Linha inferior: Toggle Rendimento CDI + Dropdown Meta */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
                      {/* Switch CDI */}
                      <label className="flex items-center gap-2 cursor-pointer select-none py-1">
                        <input
                          type="checkbox"
                          checked={cx.include_in_free_balance}
                          onChange={() => handleToggleCaixinhaCDI(cx.id, cx.include_in_free_balance)}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                        <span className="text-slate-700 font-medium text-[11px] leading-tight">
                          Somar no Saldo Livre <span className="text-emerald-600 font-bold">(CDI)</span>
                        </span>
                      </label>

                      {/* Dropdown Meta Vinculada */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-400 shrink-0 font-medium">
                          Meta:
                        </span>
                        <select
                          value={cx.linked_goal_id || ""}
                          onChange={(e) =>
                            handleLinkCaixinhaGoal(
                              cx.id,
                              e.target.value ? Number(e.target.value) : null
                            )
                          }
                          className="w-full text-xs font-semibold px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-slate-900 truncate"
                        >
                          <option value="">Nenhuma (avulsa)</option>
                          {goals.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                ))
              )}

              {/* Formulário de Nova Caixinha */}
              {isCreatingCaixinha ? (
                <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/50 space-y-3">
                  <p className="text-xs font-bold text-slate-800">Nova Caixinha</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Nome (ex: Férias, Reserva)"
                      value={newCaixinhaName}
                      onChange={(e) => setNewCaixinhaName(e.target.value)}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                      autoFocus
                    />
                    <input
                      type="text"
                      placeholder="Saldo Atual (R$)"
                      value={newCaixinhaBalance}
                      onChange={(e) => setNewCaixinhaBalance(e.target.value)}
                      className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-300 bg-white"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => {
                        setIsCreatingCaixinha(false);
                        setNewCaixinhaName("");
                        setNewCaixinhaBalance("");
                      }}
                      className="px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200/50 rounded-lg"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleCreateCaixinha}
                      disabled={savingCaixinha || !newCaixinhaName.trim()}
                      className="px-3.5 py-1 text-xs font-bold text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-50 rounded-lg"
                    >
                      {savingCaixinha ? "Salvando..." : "Criar Caixinha"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreatingCaixinha(true)}
                  className="w-full py-2.5 rounded-xl border border-dashed border-slate-300 hover:border-slate-400 text-xs font-bold text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Nova Caixinha</span>
                </button>
              )}
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsCaixinhaModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-white bg-slate-950 hover:bg-slate-800 rounded-xl"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: CONFIGURAÇÕES DO SISTEMA & OPEN FINANCE                          */}
      {/* ========================================================================= */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-slate-200 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
                  <Settings className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Configurações do Nexo
                  </h3>
                  <p className="text-xs text-slate-500">
                    Seu perfil e conexão com o Open Finance
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Campo: Nome */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Como quer ser chamado(a):
                </label>
                <input
                  type="text"
                  value={settingsFormName}
                  onChange={(e) => setSettingsFormName(e.target.value)}
                  placeholder="Seu nome ou apelido"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-slate-900"
                />
              </div>

              {/* Seção Open Finance / Pluggy */}
              <div className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/70 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span>🔌</span> Open Finance (Pluggy API)
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      pluggyConfigured
                        ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                        : "bg-amber-100 text-amber-800 border border-amber-200"
                    }`}
                  >
                    {pluggyConfigured ? "Chaves configuradas" : "Não configurado"}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-slate-600">
                      Client ID da Pluggy:
                    </label>
                    <input
                      type="text"
                      value={settingsFormClientId}
                      onChange={(e) => setSettingsFormClientId(e.target.value)}
                      placeholder={pluggyConfigured ? "•••••••••••••••• (já configurado)" : "Cole seu Client ID"}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-slate-600">
                      Client Secret da Pluggy:
                    </label>
                    <input
                      type="password"
                      value={settingsFormClientSecret}
                      onChange={(e) => setSettingsFormClientSecret(e.target.value)}
                      placeholder={pluggyConfigured ? "•••••••••••••••• (já configurado)" : "Cole seu Client Secret"}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white font-mono"
                    />
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 leading-relaxed pt-1">
                  Obtenha suas credenciais gratuitas no{" "}
                  <a
                    href="https://dashboard.pluggy.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 font-bold underline inline-flex items-center gap-0.5"
                  >
                    dashboard.pluggy.ai
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              </div>

              {/* Botão de abrir o widget de conexão do banco se as chaves estiverem salvas */}
              {pluggyConfigured && (
                <div className="pt-1">
                  <a
                    href="/connect"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-2.5 px-3 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold transition flex items-center justify-center gap-2"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-emerald-700" />
                    <span>Conectar / Trocar Banco (Widget Pluggy)</span>
                  </a>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="px-4 py-2 text-xs font-bold text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-50 rounded-xl"
              >
                {savingSettings ? "Salvando..." : "Salvar Configurações"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
