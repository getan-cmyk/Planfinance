import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, api, clearToken, getToken, setToken } from './api';
import './styles.css';

type Theme = 'light' | 'dark';
type Tab = 'dashboard' | 'transactions' | 'reports' | 'settings' | 'entry' | 'recurring' | 'fuel';
type RecurringTransaction = {
  id: string; type: string; amount_satang: number; description?: string;
  frequency: string; interval_days?: number; start_date: string; next_run_at: string;
  end_date?: string; active: number; category_name?: string; category_icon?: string; account_name: string;
  category_id?: string; account_id: string;
};
type Vehicle = { id: string; name: string; current_value_satang: number };
type FuelLog = {
  id: string; vehicle_id: string; vehicle_name: string; log_date: string;
  odometer_km: number; liters_micros: number; price_per_liter_satang: number;
  total_satang: number; station?: string; note?: string;
};
type FuelStats = { totalLiters: number; totalSpentSatang: number; kmPerLiter: number | null; thbPerKmSatang: number | null };
type Dashboard = {
  month: string;
  incomeSatang: number;
  expenseSatang: number;
  availableSatang: number;
  monthlyAvailableSatang?: number;
  liquidSatang: number;
  reservedSatang: number;
  savingsRate: number;
  emergencyCoverageMonths: number | null;
};
type Account = { id: string; name: string; type: string; balance_satang: number; currency?: string; active?: number };
type Category = { id: string; name: string; kind: 'income' | 'expense'; icon?: string; color?: string; is_default?: number };
type Budget = { id: string; category_name: string; amount_satang: number; used_satang: number };
type Transaction = {
  id: string;
  type: string;
  amount_satang: number;
  description?: string;
  payment_method?: string;
  tags_json?: string;
  transaction_date: string;
  category_name?: string;
  category_icon?: string;
  category_color?: string;
  account_name: string;
  category_id?: string;
  account_id: string;
  created_at?: string;
};
type CategoryReport = { id: string; name: string; icon?: string; color?: string; amount_satang: number; transaction_count: number };
type MonthlyReport = {
  month: string;
  summary: { incomeSatang: number; expenseSatang: number; transactionCount: number };
  categories: CategoryReport[];
  trend: { month: string; income_satang: number; expense_satang: number }[];
  previousExpenseSatang: number;
};
type YearlyReport = { year: string; months: { month: string; income_satang: number; expense_satang: number }[]; categories: CategoryReport[] };
type UserProfile = { id: number; telegram_id: string; first_name?: string; username?: string };

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
        expand?: () => void;
        initDataUnsafe?: { user?: { first_name?: string; username?: string; photo_url?: string } };
      };
    };
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => today().slice(0, 7);

const money = (satang: number, hide = false) => {
  if (hide) return '฿ ••••';
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(satang / 100);
};

const numberFormat = (val: number) => new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(val);

const monthNamesThai = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const fullMonthNamesThai = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const thaiDaysShort = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const thaiDaysFull = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];

const formatThaiMonthYear = (monthStr: string) => {
  if (!monthStr || !monthStr.includes('-')) return monthStr;
  const [y, m] = monthStr.split('-');
  const monthIdx = parseInt(m, 10) - 1;
  return `${monthNamesThai[monthIdx] ?? m} ${y}`;
};

const formatThaiMonthYearFull = (monthStr: string) => {
  if (!monthStr || !monthStr.includes('-')) return monthStr;
  const [y, m] = monthStr.split('-');
  const monthIdx = parseInt(m, 10) - 1;
  return `${fullMonthNamesThai[monthIdx] ?? m} ${y}`;
};

const formatThaiDateFull = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const dayName = thaiDaysFull[d.getDay()];
  const day = d.getDate();
  const monthName = fullMonthNamesThai[d.getMonth()];
  const year = d.getFullYear();
  return `${dayName}ที่ ${day} ${monthName} ${year}`;
};

const formatThaiDateTime = (dateStr: string, createdStr?: string) => {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const monthIdx = parseInt(m, 10) - 1;
  const shortMonth = monthNamesThai[monthIdx] ?? m;
  let time = '';
  if (createdStr) {
    const timeMatch = createdStr.match(/(\d{2}):(\d{2})/);
    if (timeMatch) time = ` ${timeMatch[1]}:${timeMatch[2]}`;
  }
  return `${parseInt(d, 10)} ${shortMonth} ${y}${time}`;
};

const getTimeGreeting = () => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'สวัสดีตอนเช้า! 👋';
  if (hour >= 12 && hour < 17) return 'สวัสดีตอนบ่าย! 👋';
  if (hour >= 17 && hour < 20) return 'สวัสดีตอนเย็น! 👋';
  return 'สวัสดีตอนค่ำ! 👋';
};

const parseTags = (value?: string) => {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const categoryLabel = (name?: string) =>
  ({
    Shopping: 'ช้อปปิ้ง',
    Fuel: 'น้ำมัน',
    Maintenance: 'ซ่อมบำรุง',
    Family: 'ให้ครอบครัว',
    Food: 'อาหาร',
    Utilities: 'ค่าน้ำ/ค่าไฟ',
    'Home Internet': 'อินเทอร์เน็ตบ้าน',
    'Mobile Internet': 'เน็ตมือถือ',
    Vehicle: 'ค่ายานพาหนะ',
    Personal: 'ของใช้ส่วนตัว',
    Health: 'สุขภาพ/ยา',
    Entertainment: 'ความบันเทิง',
    Travel: 'ท่องเที่ยว/เดินทาง',
    Other: 'อื่น ๆ',
    Salary: 'เงินเดือน',
    'Other Income': 'รายรับอื่น ๆ',
  }[name ?? ''] ??
  name ??
  'ไม่ระบุ');

const categoryIconDefault = (name?: string, fallback = '📦') =>
  ({
    Shopping: '🛍️',
    Fuel: '⛽',
    Maintenance: '🛠️',
    Family: '👨‍👩‍👧',
    Food: '🍔',
    Utilities: '💡',
    'Home Internet': '🌐',
    'Mobile Internet': '📱',
    Vehicle: '🚗',
    Personal: '👤',
    Health: '🩺',
    Entertainment: '🎮',
    Travel: '✈️',
    Other: '📦',
    Salary: '💰',
    'Other Income': '💵',
  }[name ?? ''] ?? fallback);

const categoryEmojiPalette = ['📦', '🛒', '🍜', '☕', '🚗', '⛽', '🏠', '📱', '🎮', '💊', '✈️', '🎓', '🐾', '💡', '🎁'];
const categoryEmojiFor = (name?: string, explicit?: string) => {
  if (explicit && explicit !== '📦' && explicit !== '•') return explicit;
  const value = name ?? '';
  const hash = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return categoryIconDefault(value, categoryEmojiPalette[hash % categoryEmojiPalette.length]);
};

const categoryColorDefault = (name?: string, fallback = '#64748B') =>
  ({
    Shopping: '#EF4444',
    Fuel: '#F97316',
    Maintenance: '#3B82F6',
    Family: '#8B5CF6',
    Food: '#10B981',
    Utilities: '#EAB308',
    'Home Internet': '#06B6D4',
    'Mobile Internet': '#6366F1',
    Vehicle: '#64748B',
    Personal: '#EC4899',
    Health: '#F43F5E',
    Entertainment: '#A855F7',
    Travel: '#14B8A6',
    Other: '#94A3B8',
    Salary: '#10B981',
    'Other Income': '#10B981',
  }[name ?? ''] ?? fallback);

const categoryBreakdownPalette = ['#EF4444', '#F97316', '#EAB308', '#10B981', '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899'];
const categoryBreakdownColor = (index: number) => categoryBreakdownPalette[index % categoryBreakdownPalette.length];

const accountTypeLabel = (type: string) =>
  ({
    bank: 'บัญชีธนาคาร',
    cash: 'เงินสด',
    ewallet: 'กระเป๋าเงินดิจิทัล (E-Wallet)',
    investment: 'พอร์ตการลงทุน',
    crypto: 'สินทรัพย์ดิจิทัล / คริปโต',
  }[type] ?? type);

export function App() {
  const [ready, setReady] = useState(!!getToken());
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('finance.theme') as Theme | null) ?? 'light');
  const [tab, setTab] = useState<Tab>('dashboard');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [prefillDate, setPrefillDate] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [hideBalance, setHideBalance] = useState(() => localStorage.getItem('finance.hideBalance') === 'true');
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem('finance.theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('finance.hideBalance', String(hideBalance));
  }, [hideBalance]);

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setNotice('');
    try {
      const [d, r, b, t, a, c, me] = await Promise.all([
        api<Dashboard>('/api/dashboard'),
        api<MonthlyReport>(`/api/reports/monthly?month=${selectedMonth}`),
        api<Budget[]>(`/api/budgets?month=${selectedMonth}`),
        api<{ items: Transaction[] }>('/api/transactions?limit=100'),
        api<Account[]>('/api/accounts'),
        api<Category[]>('/api/categories'),
        api<UserProfile>('/api/me').catch(() => null),
      ]);
      setDashboard(d);
      setReport(r);
      setBudgets(b);
      setTransactions(t.items);
      setAccounts(a);
      setCategories(c);
      if (me) setUserProfile(me);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearToken();
        setReady(false);
        setDashboard(null);
        setReport(null);
        setBudgets([]);
        setTransactions([]);
        setAccounts([]);
        setCategories([]);
        setNotice('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
        return;
      }
      setNotice(error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ready) void loadData();
  }, [ready, selectedMonth]);

  const login = async () => {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) {
      setNotice('เปิดใช้งานบนเว็บเบราว์เซอร์ กำลังจำลองการเข้าสู่ระบบ...');
      setReady(true);
      return;
    }
    try {
      const result = await api<{ token: string }>('/api/auth/telegram', { method: 'POST', body: JSON.stringify({ initData }) });
      setToken(result.token);
      setReady(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'เข้าสู่ระบบไม่สำเร็จ');
    }
  };

  const afterMutation = async () => {
    setEditing(null);
    setPrefillDate(null);
    setTab('dashboard');
    await loadData();
  };

  const openAddForDate = (dateStr: string) => {
    setEditing(null);
    setPrefillDate(dateStr);
    setTab('entry');
  };

  const overBudgets = useMemo(() => budgets.filter((b) => b.used_satang > b.amount_satang), [budgets]);
  const alertCount = overBudgets.length;

  if (!ready) {
    return (
      <main className="auth-hero-screen">
        <div className="auth-brand-logo">฿</div>
        <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '6px' }}>FinaPlan</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '300px', marginBottom: '24px' }}>
          จัดการการเงินอย่างชาญฉลาด เห็นภาพชัดเจน ครบทุกมิติรายรับรายจ่าย
        </p>
        <button className="btn-primary" style={{ maxWidth: '280px' }} onClick={() => void login()}>
          เปิดใช้งานผ่าน Telegram
        </button>
        {notice && <p className="notice-box error" style={{ marginTop: '16px' }}>{notice}</p>}
      </main>
    );
  }

  return (
    <div className="app-shell">
      {/* Top Header matching Mockup */}
      <header className="top-header">
        <div className="user-greeting">
          <span className="greeting-subtitle">{getTimeGreeting()}</span>
          <h1 className="app-brand-title">FinaPlan</h1>
          <span className="app-brand-tagline">จัดการการเงินอย่างชาญฉลาด</span>
        </div>
        <div className="header-right-actions">
          <button
            className="header-icon-btn"
            aria-label="การแจ้งเตือน"
            onClick={() => setShowNotifications(true)}
            title="การแจ้งเตือนและข้อสังเกต"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            {alertCount > 0 && <span className="badge-counter">{alertCount}</span>}
          </button>
          <button
            className="user-avatar-btn"
            aria-label="เปลี่ยนธีม / ข้อมูลผู้ใช้"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title={`คลิกเพื่อเปลี่ยนเป็นธีม${theme === 'light' ? 'มืด' : 'สว่าง'}`}
          >
            <span className="avatar-placeholder">
              {userProfile?.first_name ? userProfile.first_name[0].toUpperCase() : theme === 'light' ? '☀️' : '🌙'}
            </span>
          </button>
        </div>
      </header>

      {notice && <div className="notice-box error">{notice}</div>}

      {/* Main Views */}
      {tab === 'dashboard' && (
        <DashboardView
          dashboard={dashboard}
          report={report}
          budgets={budgets}
          transactions={transactions}
          hideBalance={hideBalance}
          onToggleHide={() => setHideBalance(!hideBalance)}
          onAdd={() => {
            setEditing(null);
            setPrefillDate(null);
            setTab('entry');
          }}
          onViewAllTransactions={() => setTab('transactions')}
          onViewAllReports={() => setTab('reports')}
          selectedMonth={selectedMonth}
          onSelectMonth={setSelectedMonth}
        />
      )}

      {tab === 'transactions' && (
        <TransactionsView
          items={transactions}
          categories={categories}
          onAdd={() => {
            setEditing(null);
            setPrefillDate(null);
            setTab('entry');
          }}
          onAddForDate={openAddForDate}
          onEdit={(item) => {
            setEditing(item);
            setPrefillDate(null);
            setTab('entry');
          }}
          onDeleted={() => void loadData()}
        />
      )}

      {tab === 'reports' && <ReportsView initial={report} selectedMonth={selectedMonth} onMonthChange={setSelectedMonth} />}

      {tab === 'settings' && (
        <SettingsView
          theme={theme}
          setTheme={setTheme}
          categories={categories}
          accounts={accounts}
          userProfile={userProfile}
          onChanged={() => void loadData()}
        />
      )}

      {tab === 'entry' && (
        <EntryView
          editing={editing}
          prefillDate={prefillDate}
          accounts={accounts}
          categories={categories}
          onCancel={() => {
            setEditing(null);
            setPrefillDate(null);
            setTab('dashboard');
          }}
          onDone={() => void afterMutation()}
        />
      )}

      {tab === 'recurring' && (
        <RecurringView accounts={accounts} categories={categories} onBack={() => setTab('dashboard')} />
      )}

      {tab === 'fuel' && (
        <FuelTrackerView onBack={() => setTab('dashboard')} />
      )}


      {/* Bottom Floating Navigation Bar */}
      <BottomNav
        tab={tab}
        onChange={setTab}
        onAdd={() => {
          setEditing(null);
          setPrefillDate(null);
          setTab('entry');
        }}
      />

      {/* Notifications Drawer */}
      {showNotifications && (
        <NotificationModal
          overBudgets={overBudgets}
          dashboard={dashboard}
          onClose={() => setShowNotifications(false)}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// 1. Dashboard View (Exact layout matching mockup)
// --------------------------------------------------------------------------
function DashboardView({
  dashboard,
  report,
  budgets,
  transactions,
  hideBalance,
  onToggleHide,
  onAdd,
  onViewAllTransactions,
  onViewAllReports,
  selectedMonth,
  onSelectMonth,
}: {
  dashboard: Dashboard | null;
  report: MonthlyReport | null;
  budgets: Budget[];
  transactions: Transaction[];
  hideBalance: boolean;
  onToggleHide: () => void;
  onAdd: () => void;
  onViewAllTransactions: () => void;
  onViewAllReports: () => void;
  selectedMonth: string;
  onSelectMonth: (m: string) => void;
}) {
  if (!dashboard) return <div className="empty-placeholder">กำลังโหลดข้อมูลการเงิน…</div>;

  const totalIncome = report?.summary.incomeSatang ?? dashboard.incomeSatang;
  const totalExpense = report?.summary.expenseSatang ?? dashboard.expenseSatang;
  const netSavings = totalIncome - totalExpense;
  const heroBalanceSatang = dashboard.monthlyAvailableSatang ?? dashboard.availableSatang;
  const heroBalanceTone = heroBalanceSatang < 0 ? 'negative' : 'positive';
  const heroChartData = (report?.trend ?? []).slice(-6).map((item) => ({
    month: item.month,
    netSatang: (item.income_satang ?? 0) - (item.expense_satang ?? 0),
  }));
  if (heroChartData.length === 0) heroChartData.push({ month: selectedMonth, netSatang: heroBalanceSatang });
  const heroChartMax = Math.max(1, ...heroChartData.map((item) => Math.abs(item.netSatang)));
  const remainingPercent = totalIncome > 0 ? Math.max(0, Math.round((netSavings / totalIncome) * 100)) : 0;
  const txCount = report?.summary.transactionCount ?? transactions.length;

  const sortedCategories = useMemo(() => {
    return [...(report?.categories ?? [])]
      .filter((c) => c.amount_satang > 0)
      .sort((a, b) => b.amount_satang - a.amount_satang);
  }, [report]);

  const top3 = sortedCategories.slice(0, 3);
  const recentTx = transactions.slice(0, 3);

  return (
    <section>
      {/* Navy Hero Card with Glowing Sparkline */}
      <div className="hero-balance-card">
        <div className="hero-balance-header">
          <div className="hero-label-wrap">
            <span>เงินเหลือเดือนนี้</span>
            <button className="eye-toggle-btn" onClick={onToggleHide} aria-label="ซ่อนหรือแสดงยอดเงิน" title="ซ่อน/แสดงยอดเงิน">
              {hideBalance ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              )}
            </button>
          </div>
          <button className="hero-action-chevron" onClick={onViewAllReports} aria-label="ดูรายงานเชิงลึก" title="ดูรายงานเชิงลึก">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>

        <div className={`hero-main-amount ${heroBalanceTone}`}>{money(heroBalanceSatang, hideBalance)}</div>
        <div className="hero-sub-text">จากยอดเงินจริง {money(dashboard.liquidSatang, hideBalance)}</div>

        {/* Hero compact bar chart */}
        <div className="hero-sparkline-wrap hero-bar-chart" aria-label="กราฟยอดคงเหลือรายเดือน">
          <div className="hero-bar-baseline" />
          {heroChartData.map((item) => {
            const isNegative = item.netSatang < 0;
            const height = Math.max(10, Math.round((Math.abs(item.netSatang) / heroChartMax) * 100));
            return (
              <div className="hero-bar-column" key={item.month} title={`${formatThaiMonthYear(item.month)} ${money(item.netSatang)}`}>
                <span className={`hero-bar ${isNegative ? 'negative' : 'positive'}`} style={{ height: `${height}%` }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* 4 Stat Cards */}
      <div className="stat-grid-4">
        <div className="stat-mini-card income" onClick={onViewAllTransactions} role="button" tabIndex={0} title="ดูรายการรายรับ">
          <div className="stat-icon-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="3"></rect>
              <line x1="12" y1="9" x2="12" y2="15"></line>
              <line x1="9" y1="12" x2="15" y2="12"></line>
            </svg>
          </div>
          <span className="stat-label">รายรับ</span>
          <strong className="stat-val">{money(totalIncome, hideBalance)}</strong>
        </div>

        <div className="stat-mini-card expense" onClick={onViewAllTransactions} role="button" tabIndex={0} title="ดูรายการรายจ่าย">
          <div className="stat-icon-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="3"></rect>
              <line x1="9" y1="12" x2="15" y2="12"></line>
            </svg>
          </div>
          <span className="stat-label">รายจ่าย</span>
          <strong className="stat-val">{money(totalExpense, hideBalance)}</strong>
        </div>

        <div className="stat-mini-card savings" onClick={onViewAllReports} role="button" tabIndex={0} title="ดูรายงานเงินออม">
          <div className="stat-icon-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.5-1 2-2.5.5-1.5 0-3.5-1-4.5.5-1 .5-2 0-3-.5-.8-1.5-1-1-1z"></path>
              <circle cx="16" cy="11" r="1"></circle>
            </svg>
          </div>
          <span className="stat-label">เงินออม</span>
          <strong className="stat-val">{money(netSavings, hideBalance)}</strong>
        </div>

        <div className="stat-mini-card count" onClick={onViewAllTransactions} role="button" tabIndex={0} title="ดูรายการทั้งหมด">
          <div className="stat-icon-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
          </div>
          <span className="stat-label">รายการ</span>
          <strong className="stat-val">{txCount}</strong>
        </div>
      </div>

      {/* Monthly Budget Section */}
      <div className="content-card budget-section">
        <div className="content-card-header">
          <h2 className="card-title">งบประมาณเดือนนี้</h2>
          <span className="month-badge-select">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            {formatThaiMonthYear(selectedMonth)} ⌄
          </span>
        </div>

        <div className="sub-heading">รายรับ เทียบ รายจ่าย</div>
        <div className="budget-summary-row">
          <div className="big-balance">{money(netSavings, hideBalance)}</div>
          <div className="remaining-badge">เหลือเก็บ {remainingPercent}%</div>
        </div>

        <div className="budget-progress-bar">
          <div className="budget-progress-fill" style={{ width: `${Math.min(100, Math.max(5, remainingPercent))}%` }}></div>
        </div>

        <div className="budget-dual-cards">
          <div className="budget-mini-chart-card income-side">
            <span className="mini-label">รายรับทั้งหมด</span>
            <strong className="mini-amount">{money(totalIncome, hideBalance)}</strong>
            <div className="mini-sparkline">
              <svg viewBox="0 0 124 28" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                <path
                  d="M 0,22 Q 25,18 45,24 T 80,12 T 120,8"
                  fill="none"
                  stroke="var(--income-green)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>

          <div className="budget-mini-chart-card expense-side">
            <span className="mini-label">รายจ่ายทั้งหมด</span>
            <strong className="mini-amount">{money(totalExpense, hideBalance)}</strong>
            <div className="mini-sparkline">
              <svg viewBox="0 0 124 28" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                <path
                  d="M 0,16 Q 30,24 60,18 T 90,22 T 120,10"
                  fill="none"
                  stroke="var(--expense-red)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Top Expense Categories */}
      <div className="content-card">
        <div className="content-card-header">
          <h2 className="card-title">หมวดหมู่รายจ่ายสูงสุด</h2>
          <button className="card-link-btn" onClick={onViewAllReports}>
            ดูทั้งหมด
          </button>
        </div>

        {top3.length ? (
          <div className="top-categories-list">
            {top3.map((item) => {
              const pct = totalExpense > 0 ? Math.round((item.amount_satang / totalExpense) * 100) : 0;
              const color = item.color ?? categoryColorDefault(item.name);
              const icon = categoryEmojiFor(item.name, item.icon);
              return (
                <div className="top-cat-item" key={item.id}>
                  <div className="top-cat-icon">{icon}</div>
                  <div className="top-cat-info">
                    <div className="top-cat-title-row">
                      <span className="top-cat-name">{categoryLabel(item.name)}</span>
                      <div className="top-cat-amount-group">
                        <strong className="top-cat-amount">{money(item.amount_satang, hideBalance)}</strong>
                        <span className="top-cat-percent">{pct}%</span>
                      </div>
                    </div>
                    <div className="top-cat-bar">
                      <div className="top-cat-bar-fill" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="empty-placeholder">ยังไม่มีรายจ่ายในเดือนนี้</p>
        )}
      </div>

      {/* Category Breakdown Donut */}
      <div className="content-card">
        <div className="content-card-header">
          <h2 className="card-title">รายจ่ายตามหมวดหมู่</h2>
          <button className="card-link-btn" onClick={onViewAllReports}>
            ดูทั้งหมด
          </button>
        </div>

        {sortedCategories.length ? (
          <div className="donut-breakdown-wrap">
            <div className="donut-chart-container">
              <DonutSvg categories={sortedCategories} total={totalExpense} />
              <div className="donut-center-info">
                <strong className="center-amount">{money(totalExpense, hideBalance)}</strong>
                <span className="center-sub">รวมทั้งหมด</span>
              </div>
            </div>

            <div className="donut-legend-list">
              {sortedCategories.slice(0, 6).map((item, index) => {
                const pct = totalExpense > 0 ? Math.round((item.amount_satang / totalExpense) * 100) : 0;
                const color = categoryBreakdownColor(index);
                return (
                  <div className="donut-legend-item" key={item.id}>
                    <div className="legend-left">
                      <span className="legend-dot" style={{ background: color }} />
                      <span className="legend-name">{categoryLabel(item.name)}</span>
                      <span className="legend-percent">{pct}%</span>
                    </div>
                    <strong className="legend-val">{money(item.amount_satang, hideBalance)}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="empty-placeholder">ยังไม่มีข้อมูลสำหรับแสดงแผนภูมิ</p>
        )}
      </div>

      {/* Recent Transactions List */}
      <div className="content-card">
        <div className="content-card-header">
          <h2 className="card-title">รายการล่าสุด</h2>
          <button className="card-link-btn" onClick={onViewAllTransactions}>
            ดูทั้งหมด
          </button>
        </div>

        {recentTx.length ? (
          <div className="transaction-items-list">
            {recentTx.map((tx) => {
              const isIncome = ['income', 'refund', 'interest', 'dividend', 'investment_sell'].includes(tx.type);
              const icon = categoryEmojiFor(tx.category_name, tx.category_icon ?? (isIncome ? '💰' : '📦'));
              return (
                <div className="tx-row-item" key={tx.id}>
                  <div className="tx-left-group">
                    <div className="tx-icon-box">{icon}</div>
                    <div className="tx-details">
                      <span className="tx-category-name">{categoryLabel(tx.category_name ?? tx.type)}</span>
                      <span className="tx-note-text">{tx.description || tx.payment_method || tx.account_name}</span>
                    </div>
                  </div>
                  <div className="tx-right-group">
                    <strong className={`tx-amount ${isIncome ? 'income' : 'expense'}`}>
                      {isIncome ? '+' : '-'}{money(tx.amount_satang, hideBalance)}
                    </strong>
                    <span className="tx-date-time">{formatThaiDateTime(tx.transaction_date, tx.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="empty-placeholder">ยังไม่มีรายการล่าสุด บันทึกรายการใหม่ได้ทันที</p>
        )}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
// 2. Transactions & Daily Spending Calendar View (100% Thai)
// --------------------------------------------------------------------------
function TransactionsView({
  items,
  categories,
  onAdd,
  onAddForDate,
  onEdit,
  onDeleted,
}: {
  items: Transaction[];
  categories: Category[];
  onAdd: () => void;
  onAddForDate: (dateStr: string) => void;
  onEdit: (item: Transaction) => void;
  onDeleted: () => void;
}) {
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [type, setType] = useState('all');
  const [category, setCategory] = useState('all');

  const filtered = useMemo(() => {
    return items.filter(
      (item) =>
        (!month || item.transaction_date.startsWith(month)) &&
        (type === 'all' || item.type === type) &&
        (category === 'all' || item.category_id === category) &&
        (!search ||
          `${item.description ?? ''} ${item.category_name ?? ''} ${item.payment_method ?? ''}`
            .toLowerCase()
            .includes(search.toLowerCase()))
    );
  }, [items, month, type, category, search]);

  const removeTx = async (item: Transaction) => {
    if (!window.confirm(`ต้องการลบรายการ ${categoryLabel(item.category_name)} จำนวน ${money(item.amount_satang)} หรือไม่?`)) return;
    try {
      await api(`/api/transactions/${item.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'ลบรายการไม่สำเร็จ');
    }
  };

  return (
    <section>
      {/* Top Segmented View Switcher: List vs Calendar */}
      <div className="segmented-control">
        <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>
          📋 มุมมองรายการ
        </button>
        <button className={viewMode === 'calendar' ? 'active' : ''} onClick={() => setViewMode('calendar')}>
          📅 ปฏิทินแสดงการใช้จ่ายรายวัน
        </button>
      </div>

      {viewMode === 'calendar' ? (
        <CalendarSpendingView
          transactions={items}
          onAddForDate={onAddForDate}
          onEdit={onEdit}
          onDelete={removeTx}
        />
      ) : (
        <>
          {/* Filter Bar */}
          <div className="content-card" style={{ padding: '14px' }}>
            <div className="form-row-2" style={{ marginBottom: '10px' }}>
              <input
                className="input-field"
                placeholder="🔍 ค้นหารายการ (เช่น ชื่อหมวด, รายละเอียด)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <input
                className="input-field"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
            <div className="form-row-2">
              <select className="select-field" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="all">ทุกประเภทรายการ</option>
                <option value="income">เฉพาะรายรับ</option>
                <option value="expense">เฉพาะรายจ่าย</option>
              </select>
              <select className="select-field" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="all">ทุกหมวดหมู่</option>
                {categories.map((c) => (
                  <option value={c.id} key={c.id}>
                    {categoryEmojiFor(c.name, c.icon)} {categoryLabel(c.name)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* List of Transactions */}
          <div className="content-card">
            <div className="content-card-header">
              <h2 className="card-title">รายการทั้งหมด ({filtered.length})</h2>
              <button className="card-link-btn" onClick={onAdd}>
                + เพิ่มรายการ
              </button>
            </div>

            {filtered.length ? (
              <div className="transaction-items-list">
                {filtered.map((tx) => {
                  const isIncome = ['income', 'refund', 'interest', 'dividend', 'investment_sell'].includes(tx.type);
                  const icon = categoryEmojiFor(tx.category_name, tx.category_icon ?? (isIncome ? '💰' : '📦'));
                  return (
                    <div className="tx-row-item" key={tx.id}>
                      <div className="tx-left-group">
                        <div className="tx-icon-box">{icon}</div>
                        <div className="tx-details">
                          <span className="tx-category-name">{categoryLabel(tx.category_name ?? tx.type)}</span>
                          <span className="tx-note-text">
                            {tx.description || tx.payment_method || tx.account_name} · {tx.account_name}
                          </span>
                          <div className="tx-actions-row">
                            <button className="tx-action-btn" onClick={() => onEdit(tx)}>
                              แก้ไข
                            </button>
                            <button className="tx-action-btn delete-btn" onClick={() => void removeTx(tx)}>
                              ลบ
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="tx-right-group">
                        <strong className={`tx-amount ${isIncome ? 'income' : 'expense'}`}>
                          {isIncome ? '+' : '-'}{money(tx.amount_satang)}
                        </strong>
                        <span className="tx-date-time">{formatThaiDateTime(tx.transaction_date, tx.created_at)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="empty-placeholder">ไม่พบรายการตามเงื่อนไขที่เลือก</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------
// 3. Daily Spending Calendar Component (100% Thai)
// --------------------------------------------------------------------------
function CalendarSpendingView({
  transactions,
  onAddForDate,
  onEdit,
  onDelete,
}: {
  transactions: Transaction[];
  onAddForDate: (dateStr: string) => void;
  onEdit: (item: Transaction) => void;
  onDelete: (item: Transaction) => void;
}) {
  const [currentYearMonth, setCurrentYearMonth] = useState(currentMonth());
  const [selectedDate, setSelectedDate] = useState(today());

  const [year, monthNum] = currentYearMonth.split('-').map(Number);

  const prevMonth = () => {
    const d = new Date(year, monthNum - 2, 1);
    setCurrentYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const nextMonth = () => {
    const d = new Date(year, monthNum, 1);
    setCurrentYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const dailyData = useMemo(() => {
    const map: Record<string, { incomeSatang: number; expenseSatang: number; count: number; items: Transaction[] }> = {};
    for (const tx of transactions) {
      if (!map[tx.transaction_date]) {
        map[tx.transaction_date] = { incomeSatang: 0, expenseSatang: 0, count: 0, items: [] };
      }
      const isIncome = ['income', 'refund', 'interest', 'dividend', 'investment_sell'].includes(tx.type);
      if (isIncome) {
        map[tx.transaction_date].incomeSatang += tx.amount_satang;
      } else {
        map[tx.transaction_date].expenseSatang += tx.amount_satang;
      }
      map[tx.transaction_date].count += 1;
      map[tx.transaction_date].items.push(tx);
    }
    return map;
  }, [transactions]);

  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(year, monthNum - 1, 1).getDay();
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const days = [];

    for (let i = 0; i < firstDayIndex; i++) {
      days.push({ day: 0, dateStr: '', empty: true });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({ day: d, dateStr, empty: false });
    }

    return days;
  }, [year, monthNum]);

  const monthSummary = useMemo(() => {
    let inc = 0;
    let exp = 0;
    let count = 0;
    for (const tx of transactions) {
      if (tx.transaction_date.startsWith(currentYearMonth)) {
        const isIncome = ['income', 'refund', 'interest', 'dividend', 'investment_sell'].includes(tx.type);
        if (isIncome) inc += tx.amount_satang;
        else exp += tx.amount_satang;
        count++;
      }
    }
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const dailyAvg = exp > 0 ? Math.round(exp / daysInMonth) : 0;
    return { inc, exp, count, dailyAvg };
  }, [transactions, currentYearMonth, year, monthNum]);

  const selectedDayInfo = dailyData[selectedDate] ?? { incomeSatang: 0, expenseSatang: 0, count: 0, items: [] };

  return (
    <div className="calendar-card">
      {/* Month Navigator Header */}
      <div className="calendar-header-bar">
        <button className="calendar-nav-btn" onClick={prevMonth} aria-label="เดือนก่อนหน้า" title="เดือนก่อนหน้า">
          ‹
        </button>
        <span className="calendar-current-month">{formatThaiMonthYearFull(currentYearMonth)}</span>
        <button className="calendar-nav-btn" onClick={nextMonth} aria-label="เดือนถัดไป" title="เดือนถัดไป">
          ›
        </button>
      </div>

      {/* Monthly Mini Summary Ribbon */}
      <div className="calendar-summary-ribbon">
        <div className="ribbon-item">
          <span>รายรับทั้งเดือน</span>
          <strong style={{ color: 'var(--income-green)' }}>{money(monthSummary.inc)}</strong>
        </div>
        <div className="ribbon-item">
          <span>รายจ่ายทั้งเดือน</span>
          <strong style={{ color: 'var(--expense-red)' }}>{money(monthSummary.exp)}</strong>
        </div>
        <div className="ribbon-item">
          <span>เฉลี่ย/วัน</span>
          <strong style={{ color: 'var(--text-primary)' }}>{money(monthSummary.dailyAvg)}</strong>
        </div>
      </div>

      {/* Weekdays Row */}
      <div className="calendar-weekdays-row">
        {thaiDaysShort.map((day) => (
          <div className="calendar-weekday-cell" key={day}>
            {day}
          </div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="calendar-days-grid">
        {calendarDays.map((cell, idx) => {
          if (cell.empty) {
            return <div className="calendar-day-cell empty" key={`empty-${idx}`} />;
          }

          const dayData = dailyData[cell.dateStr];
          const isSelected = selectedDate === cell.dateStr;
          const isToday = today() === cell.dateStr;
          const hasExpense = (dayData?.expenseSatang ?? 0) > 0;
          const hasIncome = (dayData?.incomeSatang ?? 0) > 0;

          return (
            <div
              key={cell.dateStr}
              className={`calendar-day-cell ${isSelected ? 'selected' : ''} ${isToday ? 'is-today' : ''}`}
              onClick={() => setSelectedDate(cell.dateStr)}
            >
              <span className="day-num">{cell.day}</span>
              <div className="day-indicator-wrap">
                {hasExpense && !isSelected && (
                  <span className="day-dot expense-dot" title={`รายจ่าย ${money(dayData!.expenseSatang)}`} />
                )}
                {hasIncome && !isSelected && (
                  <span className="day-dot income-dot" title={`รายรับ ${money(dayData!.incomeSatang)}`} />
                )}
                {hasExpense && isSelected && <span className="day-dot" style={{ background: '#FFF' }} />}
              </div>
              {hasExpense ? (
                <span className="day-mini-badge expense-tag">{numberFormat(dayData!.expenseSatang / 100)}</span>
              ) : (
                <span style={{ height: '10px' }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Selected Day Details Panel */}
      <div className="calendar-day-detail-panel">
        <div className="day-detail-header">
          <span className="day-detail-date">
            📅 {formatThaiDateFull(selectedDate)}
          </span>
          <span
            className="day-detail-net"
            style={{
              color:
                selectedDayInfo.incomeSatang >= selectedDayInfo.expenseSatang
                  ? 'var(--income-green)'
                  : 'var(--expense-red)',
            }}
          >
            {selectedDayInfo.incomeSatang > 0 && `+${money(selectedDayInfo.incomeSatang)} `}
            {selectedDayInfo.expenseSatang > 0 && `-${money(selectedDayInfo.expenseSatang)}`}
            {selectedDayInfo.incomeSatang === 0 && selectedDayInfo.expenseSatang === 0 && 'ไม่มีรายการในวันนี้'}
          </span>
        </div>

        {selectedDayInfo.items.length > 0 ? (
          <div className="transaction-items-list">
            {selectedDayInfo.items.map((tx) => {
              const isIncome = ['income', 'refund', 'interest', 'dividend', 'investment_sell'].includes(tx.type);
              const icon = categoryEmojiFor(tx.category_name, tx.category_icon ?? (isIncome ? '💰' : '📦'));
              return (
                <div className="tx-row-item" key={tx.id}>
                  <div className="tx-left-group">
                    <div className="tx-icon-box">{icon}</div>
                    <div className="tx-details">
                      <span className="tx-category-name">{categoryLabel(tx.category_name ?? tx.type)}</span>
                      <span className="tx-note-text">
                        {tx.description || tx.payment_method || tx.account_name} · {tx.account_name}
                      </span>
                      <div className="tx-actions-row">
                        <button className="tx-action-btn" onClick={() => onEdit(tx)}>
                          แก้ไข
                        </button>
                        <button className="tx-action-btn delete-btn" onClick={() => onDelete(tx)}>
                          ลบ
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="tx-right-group">
                    <strong className={`tx-amount ${isIncome ? 'income' : 'expense'}`}>
                      {isIncome ? '+' : '-'}{money(tx.amount_satang)}
                    </strong>
                    <span className="tx-date-time">{formatThaiDateTime(tx.transaction_date, tx.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="empty-placeholder" style={{ padding: '14px' }}>
            ยังไม่มีรายการในวันนี้
          </p>
        )}

        <button className="day-quick-add-btn" onClick={() => onAddForDate(selectedDate)}>
          + บันทึกรายการในวันนี้ ({formatThaiMonthYear(selectedDate.slice(0, 7))})
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// 4. Entry View (Add / Edit Transaction Modal - 100% Thai)
// --------------------------------------------------------------------------
function EntryView({
  editing,
  prefillDate,
  accounts,
  categories,
  onCancel,
  onDone,
}: {
  editing: Transaction | null;
  prefillDate: string | null;
  accounts: Account[];
  categories: Category[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const activeAccounts = accounts.filter((item) => item.active !== 0);
  const [type, setType] = useState<'income' | 'expense'>(editing?.type === 'income' ? 'income' : 'expense');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    amount: editing ? String(editing.amount_satang / 100) : '',
    category: editing?.category_id ?? categories.find((c) => c.kind === type)?.id ?? '',
    account: editing?.account_id ?? activeAccounts[0]?.id ?? '',
    description: editing?.description ?? '',
    payment: editing?.payment_method ?? '',
    tags: parseTags(editing?.tags_json).join(', '),
    date: editing?.transaction_date ?? prefillDate ?? today(),
  });

  const activeCategories = categories.filter((item) => item.kind === type);

  const updateType = (next: 'income' | 'expense') => {
    setType(next);
    setForm((prev) => ({
      ...prev,
      category: categories.find((c) => c.kind === next)?.id ?? '',
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) {
      setError('กรุณาระบุจำนวนเงินที่ถูกต้อง');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        type,
        amountSatang: Math.round(Number(form.amount) * 100),
        categoryId: form.category || null,
        accountId: form.account,
        description: form.description || undefined,
        paymentMethod: form.payment || undefined,
        tags: form.tags
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        transactionDate: form.date,
      };
      await api(editing ? `/api/transactions/${editing.id}` : '/api/transactions', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกรายการไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (!activeAccounts.length) {
    return (
      <div className="content-card">
        <div className="notice-box error">ยังไม่มีบัญชีที่เปิดใช้งาน กรุณาเพิ่มบัญชีในเมนูตั้งค่าก่อน</div>
        <button className="btn-secondary" onClick={onCancel} style={{ width: '100%', marginTop: '10px' }}>
          กลับ
        </button>
      </div>
    );
  }

  return (
    <div className="content-card">
      <div className="content-card-header">
        <h2 className="card-title">{editing ? 'แก้ไขรายการ' : 'บันทึกรายการใหม่'}</h2>
        <button className="card-link-btn" onClick={onCancel}>
          ปิด
        </button>
      </div>

      <form onSubmit={(e) => void submit(e)}>
        {/* Type Toggle: Expense vs Income */}
        <div className="segmented-control">
          <button
            type="button"
            className={type === 'expense' ? 'active expense-tab' : ''}
            onClick={() => updateType('expense')}
          >
            ↘ รายจ่าย
          </button>
          <button
            type="button"
            className={type === 'income' ? 'active income-tab' : ''}
            onClick={() => updateType('income')}
          >
            ↗ รายรับ
          </button>
        </div>

        {/* Hero Amount Input */}
        <div className="form-group">
          <label>จำนวนเงิน (บาท)</label>
          <input
            className="input-field amount-hero-input"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
            autoFocus
          />
        </div>

        {/* Category & Account */}
        <div className="form-row-2">
          <div className="form-group">
            <label>หมวดหมู่</label>
            <select
              className="select-field"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              required
            >
              {activeCategories.map((c) => (
                <option value={c.id} key={c.id}>
                  {categoryEmojiFor(c.name, c.icon)} {categoryLabel(c.name)}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>บัญชีที่ใช้จ่าย / รับเงิน</label>
            <select
              className="select-field"
              value={form.account}
              onChange={(e) => setForm({ ...form, account: e.target.value })}
              required
            >
              {activeAccounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name} ({money(a.balance_satang)})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Date & Payment Method */}
        <div className="form-row-2">
          <div className="form-group">
            <label>วันที่ทำรายการ</label>
            <input
              className="input-field"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label>ช่องทางชำระเงิน</label>
            <select
              className="select-field"
              value={form.payment}
              onChange={(e) => setForm({ ...form, payment: e.target.value })}
            >
              <option value="">ไม่ระบุ</option>
              <option>เงินสด</option>
              <option>โอนเงิน / พร้อมเพย์</option>
              <option>บัตรเครดิต</option>
              <option>คิวอาร์โค้ด (QR Code)</option>
              <option>อื่น ๆ</option>
            </select>
          </div>
        </div>

        {/* Description & Tags */}
        <div className="form-group">
          <label>รายละเอียด / บันทึกช่วยจำ</label>
          <input
            className="input-field"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={type === 'expense' ? 'เช่น ซื้อกาแฟ, เติมน้ำมัน, ค่าอาหารเย็น' : 'เช่น เงินเดือน, เงินโอน, ขายของ'}
            maxLength={500}
          />
        </div>

        <div className="form-group">
          <label>แท็กหมวดหมู่ย่อย (คั่นด้วยจุลภาค)</label>
          <input
            className="input-field"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="เช่น ของกิน, ค่าห้อง, บิลรายเดือน"
          />
        </div>

        {error && <div className="notice-box error">{error}</div>}

        <div className="form-row-2" style={{ marginTop: '16px' }}>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            ยกเลิก
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'กำลังบันทึก…' : editing ? 'บันทึกการแก้ไข' : `บันทึก${type === 'expense' ? 'รายจ่าย' : 'รายรับ'}`}
          </button>
        </div>
      </form>
    </div>
  );
}

// --------------------------------------------------------------------------
// 5. Reports & Analytics View (100% Thai)
// --------------------------------------------------------------------------
function ReportsView({
  initial,
  selectedMonth,
  onMonthChange,
}: {
  initial: MonthlyReport | null;
  selectedMonth: string;
  onMonthChange: (m: string) => void;
}) {
  const [mode, setMode] = useState<'monthly' | 'yearly'>('monthly');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [monthly, setMonthly] = useState<MonthlyReport | null>(initial);
  const [yearly, setYearly] = useState<YearlyReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const path = mode === 'monthly' ? `/api/reports/monthly?month=${selectedMonth}` : `/api/reports/yearly?year=${year}`;
    void api<MonthlyReport | YearlyReport>(path)
      .then((data) => {
        if (!active) return;
        if (mode === 'monthly') setMonthly(data as MonthlyReport);
        else setYearly(data as YearlyReport);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, selectedMonth, year]);

  const activeCategories = (mode === 'monthly' ? monthly?.categories : yearly?.categories)?.filter((c) => c.amount_satang > 0) ?? [];
  const totalExpense = activeCategories.reduce((sum, c) => sum + c.amount_satang, 0);

  return (
    <section>
      <div className="content-card">
        <div className="content-card-header">
          <h2 className="card-title">รายงานและการวิเคราะห์</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ExportButton month={mode === 'monthly' ? selectedMonth : undefined} />
          </div>
        </div>

        <div className="segmented-control">
          <button className={mode === 'monthly' ? 'active' : ''} onClick={() => setMode('monthly')}>
            รายงานรายเดือน
          </button>
          <button className={mode === 'yearly' ? 'active' : ''} onClick={() => setMode('yearly')}>
            รายงานรายปี
          </button>
        </div>

        {mode === 'monthly' ? (
          <>
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <input
                className="input-field"
                type="month"
                value={selectedMonth}
                onChange={(e) => onMonthChange(e.target.value)}
              />
            </div>

            {monthly && (
              <>
                <div className="stat-grid-4" style={{ marginBottom: '16px' }}>
                  <div className="stat-mini-card income">
                    <span className="stat-label">รายรับ</span>
                    <strong className="stat-val">{money(monthly.summary.incomeSatang)}</strong>
                  </div>
                  <div className="stat-mini-card expense">
                    <span className="stat-label">รายจ่าย</span>
                    <strong className="stat-val">{money(monthly.summary.expenseSatang)}</strong>
                  </div>
                  <div className="stat-mini-card savings">
                    <span className="stat-label">ยอดสุทธิ</span>
                    <strong className="stat-val">{money(monthly.summary.incomeSatang - monthly.summary.expenseSatang)}</strong>
                  </div>
                  <div className="stat-mini-card count">
                    <span className="stat-label">รายการ</span>
                    <strong className="stat-val">{monthly.summary.transactionCount}</strong>
                  </div>
                </div>

                <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 800, marginBottom: '12px' }}>สัดส่วนรายจ่ายตามหมวดหมู่</h3>
                  <div className="donut-breakdown-wrap">
                    <div className="donut-chart-container">
                      <DonutSvg categories={activeCategories} total={totalExpense} />
                      <div className="donut-center-info">
                        <strong className="center-amount">{money(totalExpense)}</strong>
                        <span className="center-sub">รวม</span>
                      </div>
                    </div>
                    <div className="donut-legend-list">
                      {activeCategories.map((item, index) => {
                        const pct = totalExpense ? Math.round((item.amount_satang / totalExpense) * 100) : 0;
                        return (
                          <div className="donut-legend-item" key={item.id}>
                            <div className="legend-left">
                              <span className="legend-dot" style={{ background: categoryBreakdownColor(index) }} />
                              <span className="legend-name">{categoryLabel(item.name)}</span>
                              <span className="legend-percent">{pct}%</span>
                            </div>
                            <strong className="legend-val">{money(item.amount_satang)}</strong>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '20px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>แนวโน้มย้อนหลัง 6 เดือน</h3>
                  <TrendBarChart data={monthly.trend} />
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <select className="select-field" value={year} onChange={(e) => setYear(e.target.value)}>
                {[0, 1, 2, 3, 4].map((offset) => {
                  const y = Number(new Date().getFullYear()) - offset;
                  return (
                    <option key={y} value={String(y)}>
                      ปี {y}
                    </option>
                  );
                })}
              </select>
            </div>

            {yearly && (
              <>
                <div className="stat-grid-4" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: '16px' }}>
                  <div className="stat-mini-card income">
                    <span className="stat-label">รายรับทั้งปี</span>
                    <strong className="stat-val">{money(yearly.months.reduce((s, i) => s + i.income_satang, 0))}</strong>
                  </div>
                  <div className="stat-mini-card expense">
                    <span className="stat-label">รายจ่ายทั้งปี</span>
                    <strong className="stat-val">{money(yearly.months.reduce((s, i) => s + i.expense_satang, 0))}</strong>
                  </div>
                </div>

                <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 800, marginBottom: '12px' }}>รายจ่ายตามหมวดหมู่ในปี {year}</h3>
                  <div className="donut-breakdown-wrap">
                    <div className="donut-chart-container">
                      <DonutSvg categories={activeCategories} total={totalExpense} />
                      <div className="donut-center-info">
                        <strong className="center-amount">{money(totalExpense)}</strong>
                        <span className="center-sub">รวมทั้งปี</span>
                      </div>
                    </div>
                    <div className="donut-legend-list">
                      {activeCategories.map((item, index) => {
                        const pct = totalExpense ? Math.round((item.amount_satang / totalExpense) * 100) : 0;
                        return (
                          <div className="donut-legend-item" key={item.id}>
                            <div className="legend-left">
                              <span className="legend-dot" style={{ background: categoryBreakdownColor(index) }} />
                              <span className="legend-name">{categoryLabel(item.name)}</span>
                              <span className="legend-percent">{pct}%</span>
                            </div>
                            <strong className="legend-val">{money(item.amount_satang)}</strong>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '20px' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 800, marginBottom: '10px' }}>รายรับ / รายจ่ายแต่ละเดือนในปี {year}</h3>
                  <TrendBarChart data={yearly.months} />
                </div>
              </>
            )}
          </>
        )}

        {loading && <p className="empty-placeholder">กำลังโหลดรายงาน…</p>}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
// 6. Settings View (100% Thai)
// --------------------------------------------------------------------------
function SettingsView({
  theme,
  setTheme,
  categories,
  accounts,
  userProfile,
  onChanged,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
  categories: Category[];
  accounts: Account[];
  userProfile: UserProfile | null;
  onChanged: () => void;
}) {
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [name, setName] = useState('');
  const [savingCat, setSavingCat] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: '', type: 'bank', balance: '' });
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState('');

  const addCategory = async () => {
    if (!name.trim()) return;
    setSavingCat(true);
    try {
      await api('/api/categories', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          name: name.trim(),
          icon: kind === 'expense' ? '📦' : '💰',
          color: kind === 'expense' ? '#EF4444' : '#10B981',
        }),
      });
      setName('');
      onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'เพิ่มหมวดหมู่ไม่สำเร็จ');
    } finally {
      setSavingCat(false);
    }
  };

  const removeCategory = async (cat: Category) => {
    if (!window.confirm(`ต้องการลบหมวดหมู่ "${categoryLabel(cat.name)}" หรือไม่?`)) return;
    try {
      await api(`/api/categories/${cat.id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'ลบหมวดหมู่ไม่สำเร็จ');
    }
  };

  const addAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!accountForm.name.trim()) return;
    setAccountSaving(true);
    setAccountError('');
    try {
      await api('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: accountForm.name.trim(),
          type: accountForm.type,
          balanceSatang: Math.round(Number(accountForm.balance || 0) * 100),
        }),
      });
      setAccountForm({ name: '', type: 'bank', balance: '' });
      onChanged();
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'เพิ่มบัญชีไม่สำเร็จ');
    } finally {
      setAccountSaving(false);
    }
  };

  const renameAccount = async (account: Account) => {
    const next = window.prompt('ระบุชื่อบัญชีใหม่', account.name)?.trim();
    if (!next || next === account.name) return;
    try {
      await api(`/api/accounts/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: next, type: account.type, currency: account.currency ?? 'THB', active: account.active !== 0 }),
      });
      onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'แก้ไขชื่อบัญชีไม่สำเร็จ');
    }
  };

  const archiveAccount = async (account: Account) => {
    if (!window.confirm(`ต้องการปิดการใช้งานบัญชี "${account.name}" หรือไม่?`)) return;
    try {
      await api(`/api/accounts/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: account.name, type: account.type, currency: account.currency ?? 'THB', active: false }),
      });
      onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'ปิดการใช้งานบัญชีไม่สำเร็จ');
    }
  };

  return (
    <section>
      {/* Theme Settings */}
      <div className="content-card">
        <div className="content-card-header">
          <h2 className="card-title">การแสดงผล (ธีม)</h2>
        </div>
        <div className="theme-switch-row">
          <div>
            <strong style={{ fontSize: '14px', display: 'block' }}>{theme === 'light' ? 'ธีมสว่าง (Light Mode)' : 'ธีมมืด (Dark Mode)'}</strong>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {theme === 'light' ? 'พื้นหลังสะอาด สบายตา ตัวหนังสือชัดเจน' : 'พื้นหลังสีมืด ถนอมสายตา และประหยัดพลังงาน'}
            </span>
          </div>
          <div
            className={`theme-switch-toggle ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            role="button"
            tabIndex={0}
            title="คลิกเพื่อสลับธีม"
          >
            <span className="theme-switch-thumb" />
          </div>
        </div>
      </div>

      {/* Account Management */}
      <div className="content-card">
        <div className="content-card-header">
          <h2 className="card-title">บัญชีของฉัน ({accounts.length})</h2>
          <span className="month-badge-select">เพิ่มได้ไม่จำกัด</span>
        </div>

        <div style={{ marginBottom: '16px' }}>
          {accounts.map((acc) => (
            <div className="account-item-row" key={acc.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className="tx-icon-box" style={{ width: '36px', height: '36px', fontSize: '16px' }}>
                  {acc.type === 'bank' ? '🏦' : acc.type === 'cash' ? '💵' : '💳'}
                </div>
                <div>
                  <strong style={{ fontSize: '13px', display: 'block' }}>{acc.name}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {accountTypeLabel(acc.type)} {acc.active === 0 && ' · (ปิดใช้งาน)'}
                  </span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ fontSize: '14px', display: 'block' }}>{money(acc.balance_satang)}</strong>
                {acc.active !== 0 && (
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '2px' }}>
                    <button className="tx-action-btn" onClick={() => void renameAccount(acc)}>
                      แก้ไขชื่อ
                    </button>
                    <button className="tx-action-btn delete-btn" onClick={() => void archiveAccount(acc)}>
                      ปิดใช้งาน
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={(e) => void addAccount(e)} style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '14px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>+ เพิ่มบัญชีใหม่</h3>
          <div className="form-group">
            <input
              className="input-field"
              value={accountForm.name}
              onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
              placeholder="ชื่อบัญชี เช่น กสิกรไทย, เงินสด, บัตรเครดิต"
              required
            />
          </div>
          <div className="form-row-2">
            <select
              className="select-field"
              value={accountForm.type}
              onChange={(e) => setAccountForm({ ...accountForm, type: e.target.value })}
            >
              <option value="bank">บัญชีธนาคาร</option>
              <option value="cash">เงินสด</option>
              <option value="ewallet">กระเป๋าเงินดิจิทัล (E-Wallet)</option>
              <option value="investment">พอร์ตการลงทุน</option>
              <option value="crypto">สินทรัพย์ดิจิทัล / คริปโต</option>
            </select>
            <input
              className="input-field"
              type="number"
              min="0"
              step="0.01"
              value={accountForm.balance}
              onChange={(e) => setAccountForm({ ...accountForm, balance: e.target.value })}
              placeholder="ยอดเงินเริ่มต้น (บาท)"
            />
          </div>
          {accountError && <div className="notice-box error">{accountError}</div>}
          <button className="btn-primary" style={{ marginTop: '10px' }} disabled={accountSaving}>
            {accountSaving ? 'กำลังเพิ่ม…' : 'เพิ่มบัญชี'}
          </button>
        </form>
      </div>

      {/* Category Management */}
      <div className="content-card">
        <div className="content-card-header">
          <h2 className="card-title">หมวดหมู่ทั้งหมด ({categories.length})</h2>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          {categories.map((c) => (
            <span
              key={c.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '99px',
                fontSize: '12px',
                fontWeight: 600,
                background: c.kind === 'income' ? 'var(--income-green-bg)' : 'var(--expense-red-bg)',
                color: c.kind === 'income' ? 'var(--income-green)' : 'var(--expense-red)',
                border: `1px solid ${c.kind === 'income' ? 'var(--income-green-border)' : 'var(--expense-red-border)'}`,
              }}
            >
              {categoryEmojiFor(c.name, c.icon)} {categoryLabel(c.name)}
              <button
                onClick={() => void removeCategory(c)}
                style={{ fontSize: '14px', marginLeft: '4px', opacity: 0.7 }}
                aria-label={`ลบหมวดหมู่ ${categoryLabel(c.name)}`}
                title={`ลบหมวดหมู่ ${categoryLabel(c.name)}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>

        <div className="form-row-2">
          <select className="select-field" value={kind} onChange={(e) => setKind(e.target.value as 'expense' | 'income')}>
            <option value="expense">หมวดรายจ่าย</option>
            <option value="income">หมวดรายรับ</option>
          </select>
          <input
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ชื่อหมวดหมู่ใหม่"
          />
        </div>
        <button
          className="btn-secondary"
          style={{ width: '100%', marginTop: '10px' }}
          disabled={savingCat}
          onClick={() => void addCategory()}
        >
          {savingCat ? 'กำลังเพิ่ม…' : '+ เพิ่มหมวดหมู่'}
        </button>
      </div>

      {/* Telegram User Profile */}
      {userProfile && (
        <div className="content-card" style={{ textAlign: 'center', padding: '16px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            เชื่อมต่อผ่าน Telegram ID: <strong>{userProfile.telegram_id}</strong>
            {userProfile.username && ` (@${userProfile.username})`}
          </p>
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------
// 7. Notification Drawer Modal (100% Thai)
// --------------------------------------------------------------------------
function NotificationModal({
  overBudgets,
  dashboard,
  onClose,
}: {
  overBudgets: Budget[];
  dashboard: Dashboard | null;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-drag-handle" />
        <div className="content-card-header">
          <h2 className="card-title">🔔 การแจ้งเตือนและข้อสังเกต</h2>
          <button className="card-link-btn" onClick={onClose}>
            ปิด
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
          {overBudgets.length > 0 ? (
            <div className="notice-box error">
              <strong>⚠️ แจ้งเตือนการใช้จ่ายเกินงบประมาณ</strong>
              <ul style={{ margin: '6px 0 0 16px', fontSize: '12px' }}>
                {overBudgets.map((b) => (
                  <li key={b.id}>
                    หมวด <strong>{categoryLabel(b.category_name)}</strong>: ใช้ไปแล้ว {money(b.used_satang)} จากงบ {money(b.amount_satang)} (เกินงบ {money(b.used_satang - b.amount_satang)})
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="notice-box info">
              ✅ ทุกหมวดหมู่ยังอยู่ภายใต้งบประมาณที่กำหนดในเดือนนี้
            </div>
          )}

          {dashboard && (
            <div className="notice-box info">
              💡 <strong>อัตราการออมในเดือนนี้:</strong> {dashboard.savingsRate}%
              {dashboard.savingsRate >= 20 ? ' (ยอดเยี่ยม! อยู่ในเกณฑ์มาตรฐานที่ดี)' : ' (ควรพยายามลดรายจ่ายที่ไม่จำเป็น)'}
            </div>
          )}

          <div className="notice-box info">
            📊 <strong>คำแนะนำ:</strong> คุณสามารถใช้แท็บ <strong>"ปฏิทินแสดงการใช้จ่ายรายวัน"</strong> ในหน้ารายการ เพื่อดูว่าวันไหนที่คุณใช้จ่ายมากที่สุดในแต่ละสัปดาห์
          </div>
        </div>

        <button className="btn-primary" style={{ marginTop: '16px' }} onClick={onClose}>
          รับทราบ
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// 8. Bottom Navigation (100% Thai) — 6 items + FAB
// --------------------------------------------------------------------------
function BottomNav({
  tab,
  onChange,
  onAdd,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
  onAdd: () => void;
}) {
  return (
    <div className="bottom-nav-bar">
      <nav className="bottom-nav-inner">
        <button className={`bottom-nav-tab ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => onChange('dashboard')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
          <span>หน้าหลัก</span>
        </button>

        <button className={`bottom-nav-tab ${tab === 'transactions' ? 'active' : ''}`} onClick={() => onChange('transactions')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <line x1="3" y1="6" x2="3.01" y2="6"></line>
            <line x1="3" y1="12" x2="3.01" y2="12"></line>
            <line x1="3" y1="18" x2="3.01" y2="18"></line>
          </svg>
          <span>รายการ</span>
        </button>

        {/* Floating Add Action Button */}
        <button className="bottom-nav-fab" onClick={onAdd} aria-label="บันทึกรายการ" title="บันทึกรายการ">
          +
        </button>

        <button className={`bottom-nav-tab ${tab === 'recurring' ? 'active' : ''}`} onClick={() => onChange('recurring')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 1 21 5 17 9"></polyline>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
            <polyline points="7 23 3 19 7 15"></polyline>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
          </svg>
          <span className="unrequested-nav-label">ประจำ</span>
        </button>

        <button className={`bottom-nav-tab ${tab === 'fuel' ? 'active' : ''}`} onClick={() => onChange('fuel')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 22V8l9-4 9 4v14"></path>
            <path d="M3 22H21"></path>
            <path d="M9 22V12h6v10"></path>
          </svg>
          <span className="unrequested-nav-label">น้ำมัน</span>
        </button>

        <button className={`bottom-nav-tab ${tab === 'reports' || tab === 'settings' ? 'active' : ''}`} onClick={() => onChange('reports')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
            <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
          </svg>
          <span>รายงาน</span>
        </button>

        <button className={`bottom-nav-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => onChange('settings')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.5 1.5-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20h-2.12v-.41a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-1.5-1.5.06-.06A1.7 1.7 0 0 0 9.6 15a1.7 1.7 0 0 0-1.55-1H7.6v-2.12h.45a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.5-1.5.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1-1.55V5h2.12v.41a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.5 1.5-.06.06A1.7 1.7 0 0 0 19.4 10c.23.6.8 1 1.45 1h.55v2.12h-.45a1.7 1.7 0 0 0-1.55 1.88z"></path>
          </svg>
          <span>ตั้งค่า</span>
        </button>
      </nav>
    </div>
  );
}


// --------------------------------------------------------------------------
// 9. Donut & Trend Chart Helpers
// --------------------------------------------------------------------------
function DonutSvg({ categories, total }: { categories: CategoryReport[]; total: number }) {
  if (!total || !categories.length) {
    return (
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r="38" fill="none" stroke="var(--border-color)" strokeWidth="16" />
      </svg>
    );
  }

  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  let accumulatedPercent = 0;

  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
      {categories.map((c, index) => {
        const pct = c.amount_satang / total;
        const strokeDasharray = `${pct * circumference} ${circumference}`;
        const strokeDashoffset = -accumulatedPercent * circumference;
        accumulatedPercent += pct;
        const color = categoryBreakdownColor(index);

        return (
          <circle
            key={c.id}
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="16"
            strokeDasharray={strokeDasharray}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="butt"
          />
        );
      })}
    </svg>
  );
}

function TrendBarChart({
  data,
}: {
  data: { month: string; income_satang?: number; expense_satang?: number }[];
}) {
  const max = Math.max(1, ...data.flatMap((item) => [item.income_satang ?? 0, item.expense_satang ?? 0]));

  return (
    <div className="trend-chart-card">
      <div className="trend-chart-legend" aria-label="คำอธิบายกราฟ">
        <span><i className="trend-legend-dot income" />รายรับ</span>
        <span><i className="trend-legend-dot expense" />รายจ่าย</span>
      </div>
      <div className="trend-bar-chart">
        {data.map((item) => (
          <div className="trend-bar-column" key={item.month}>
            <div className="trend-bars">
              <span
                className="trend-bar income"
                style={{ height: `${Math.max(4, ((item.income_satang ?? 0) / max) * 100)}%` }}
                title={`รายรับ ${money(item.income_satang ?? 0)}`}
              />
              <span
                className="trend-bar expense"
                style={{ height: `${Math.max(4, ((item.expense_satang ?? 0) / max) * 100)}%` }}
                title={`รายจ่าย ${money(item.expense_satang ?? 0)}`}
              />
            </div>
            <span className="trend-label">{formatThaiMonthYear(item.month).split(' ')[0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// 10. Recurring Transactions View
// --------------------------------------------------------------------------
const frequencyLabel = (f: string, intervalDays?: number) =>
  ({ weekly: 'รายสัปดาห์', monthly: 'รายเดือน', yearly: 'รายปี', custom: `ทุก ${intervalDays ?? '?'} วัน` }[f] ?? f);

function RecurringView({ accounts, categories, onBack }: { accounts: Account[]; categories: Category[]; onBack: () => void }) {
  const [items, setItems] = useState<RecurringTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'expense', amountSatang: '', categoryId: '', accountId: '', description: '', frequency: 'monthly', intervalDays: '30', startDate: today() });

  const load = async () => { setLoading(true); try { const r = await api<RecurringTransaction[]>('/api/recurring'); setItems(r); } catch (e) { setNotice(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'); } finally { setLoading(false); } };

  useEffect(() => { void load(); }, []);

  const expenseCategories = categories.filter(c => c.kind === (form.type as 'income' | 'expense'));
  const activeAccounts = accounts.filter(a => a.active !== 0);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const amountBaht = parseFloat(form.amountSatang);
    if (isNaN(amountBaht) || amountBaht <= 0) { setNotice('กรุณาระบุจำนวนเงินที่ถูกต้อง'); return; }
    if (!form.accountId) { setNotice('กรุณาเลือกบัญชี'); return; }
    try {
      await api<{ id: string }>('/api/recurring', {
        method: 'POST',
        body: JSON.stringify({
          type: form.type,
          amountSatang: Math.round(amountBaht * 100),
          categoryId: form.categoryId || null,
          accountId: form.accountId,
          description: form.description || undefined,
          frequency: form.frequency,
          intervalDays: form.frequency === 'custom' ? parseInt(form.intervalDays) : undefined,
          startDate: form.startDate,
        }),
      });
      setShowForm(false);
      setForm({ type: 'expense', amountSatang: '', categoryId: '', accountId: '', description: '', frequency: 'monthly', intervalDays: '30', startDate: today() });
      setNotice('');
      await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('ต้องการลบรายการประจำนี้?')) return;
    try { await api(`/api/recurring/${id}`, { method: 'DELETE' }); await load(); } catch (e) { setNotice(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'); }
  };

  const handleToggleActive = async (item: RecurringTransaction) => {
    try {
      await api(`/api/recurring/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          type: item.type, amountSatang: item.amount_satang, categoryId: item.category_id, accountId: item.account_id,
          description: item.description, frequency: item.frequency, intervalDays: item.interval_days, startDate: item.start_date, active: !item.active,
        }),
      });
      await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'); }
  };

  const monthlyTotal = items.filter(r => r.active && r.type === 'expense').reduce((s, r) => {
    const days = r.frequency === 'weekly' ? 7 : r.frequency === 'yearly' ? 365 : r.interval_days ?? 30;
    return s + Math.round((r.amount_satang / days) * 30);
  }, 0);

  return (
    <section className="view-section">
      <div className="section-header-row">
        <button className="back-btn" onClick={onBack}>←</button>
        <h2 className="section-title">🔄 รายการประจำ</h2>
        <button className="btn-primary" style={{ fontSize: '13px', padding: '6px 14px' }} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'ยกเลิก' : '+ เพิ่มใหม่'}
        </button>
      </div>

      {notice && <div className="notice-box error">{notice}</div>}

      {/* Monthly recurring cost summary */}
      <div className="hero-balance-card" style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', opacity: 0.85, marginBottom: '4px' }}>ค่าใช้จ่ายประจำ (โดยประมาณ/เดือน)</div>
        <div style={{ fontSize: '28px', fontWeight: 800 }}>{money(monthlyTotal)}</div>
        <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>จาก {items.filter(r => r.active).length} รายการที่เปิดใช้งาน</div>
      </div>

      {/* Add Form */}
      {showForm && (
        <form className="card-section" onSubmit={e => void handleSave(e)} style={{ marginBottom: '12px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>เพิ่มรายการประจำใหม่</h3>
          <div className="form-group">
            <label className="form-label">ประเภท</label>
            <select className="form-control" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value, categoryId: '' }))}>
              <option value="expense">รายจ่าย</option>
              <option value="income">รายรับ</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">จำนวนเงิน (บาท)</label>
            <input className="form-control" type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amountSatang} onChange={e => setForm(f => ({ ...f, amountSatang: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">หมวดหมู่</label>
            <select className="form-control" value={form.categoryId} onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}>
              <option value="">ไม่ระบุหมวดหมู่</option>
              {expenseCategories.map(c => <option key={c.id} value={c.id}>{categoryLabel(c.name)}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">บัญชี *</label>
            <select className="form-control" value={form.accountId} onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))} required>
              <option value="">เลือกบัญชี</option>
              {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">คำอธิบาย</label>
            <input className="form-control" type="text" placeholder="เช่น Netflix, ค่าเช่า, ค่าน้ำ" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">ความถี่</label>
            <select className="form-control" value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
              <option value="weekly">รายสัปดาห์</option>
              <option value="monthly">รายเดือน</option>
              <option value="yearly">รายปี</option>
              <option value="custom">กำหนดเอง (จำนวนวัน)</option>
            </select>
          </div>
          {form.frequency === 'custom' && (
            <div className="form-group">
              <label className="form-label">ทุกกี่วัน</label>
              <input className="form-control" type="number" min="1" value={form.intervalDays} onChange={e => setForm(f => ({ ...f, intervalDays: e.target.value }))} />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">วันที่เริ่มต้น</label>
            <input className="form-control" type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} required />
          </div>
          <button className="btn-primary" type="submit" style={{ width: '100%', marginTop: '8px' }}>💾 บันทึก</button>
        </form>
      )}

      {/* Recurring list */}
      {loading && <div className="empty-placeholder">กำลังโหลด...</div>}
      {!loading && items.length === 0 && !showForm && (
        <div className="empty-placeholder">
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔄</div>
          <div>ยังไม่มีรายการประจำ</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px' }}>กดปุ่ม "เพิ่มใหม่" เพื่อเพิ่มรายการประจำ เช่น Netflix, ค่าเช่า, เงินเดือน</div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {items.map(item => (
          <div key={item.id} className="card-section" style={{ opacity: item.active ? 1 : 0.55 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '16px' }}>{item.type === 'income' ? '💚' : '❤️'}</span>
                  <span style={{ fontWeight: 700, fontSize: '15px' }}>{item.description || categoryLabel(item.category_name) || 'ไม่ระบุ'}</span>
                  {!item.active && <span style={{ fontSize: '11px', background: 'var(--border-color)', borderRadius: '6px', padding: '2px 8px' }}>หยุด</span>}
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: item.type === 'income' ? 'var(--income-green)' : 'var(--expense-red)' }}>
                  {item.type === 'expense' ? '-' : '+'}{money(item.amount_satang)}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {frequencyLabel(item.frequency, item.interval_days)} • บัญชี: {item.account_name}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  รอบถัดไป: {item.next_run_at}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                <button
                  style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '8px', border: '1.5px solid var(--border-color)', background: 'transparent', color: item.active ? 'var(--expense-red)' : 'var(--income-green)', cursor: 'pointer' }}
                  onClick={() => void handleToggleActive(item)}
                >
                  {item.active ? 'หยุด' : 'เปิด'}
                </button>
                <button
                  style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '8px', border: '1.5px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
                  onClick={() => void handleDelete(item.id)}
                >
                  ลบ
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
// 11. Fuel & Vehicle Mileage Tracker View
// --------------------------------------------------------------------------
function FuelTrackerView({ onBack }: { onBack: () => void }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [stats, setStats] = useState<FuelStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [showLogForm, setShowLogForm] = useState(false);
  const [vehicleName, setVehicleName] = useState('');
  const [logForm, setLogForm] = useState({ logDate: today(), odometerKm: '', liters: '', pricePerLiter: '', station: '', note: '' });

  const loadVehicles = async () => {
    const v = await api<Vehicle[]>('/api/vehicles');
    setVehicles(v);
    if (!selectedVehicleId && v.length > 0) setSelectedVehicleId(v[0].id);
  };

  const loadLogs = async (vehicleId: string) => {
    if (!vehicleId) return;
    setLoading(true);
    try {
      const r = await api<{ logs: FuelLog[]; stats: FuelStats }>(`/api/fuel-logs?vehicleId=${vehicleId}`);
      setLogs(r.logs);
      setStats(r.stats);
    } catch (e) { setNotice(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadVehicles(); }, []);
  useEffect(() => { if (selectedVehicleId) void loadLogs(selectedVehicleId); }, [selectedVehicleId]);

  const handleAddVehicle = async (e: FormEvent) => {
    e.preventDefault();
    if (!vehicleName.trim()) return;
    try {
      await api<{ id: string }>('/api/vehicles', { method: 'POST', body: JSON.stringify({ name: vehicleName.trim(), currentValueSatang: 0 }) });
      setVehicleName('');
      setShowVehicleForm(false);
      await loadVehicles();
    } catch (e) { setNotice(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'); }
  };

  const handleAddLog = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedVehicleId) { setNotice('กรุณาเลือกรถก่อน'); return; }
    const liters = parseFloat(logForm.liters);
    const pricePerLiter = parseFloat(logForm.pricePerLiter);
    const odometerKm = parseInt(logForm.odometerKm);
    if (isNaN(liters) || liters <= 0) { setNotice('กรุณาระบุจำนวนลิตรที่ถูกต้อง'); return; }
    if (isNaN(pricePerLiter) || pricePerLiter <= 0) { setNotice('กรุณาระบุราคาต่อลิตรที่ถูกต้อง'); return; }
    if (isNaN(odometerKm) || odometerKm < 0) { setNotice('กรุณาระบุเลขไมล์ที่ถูกต้อง'); return; }
    const totalSatang = Math.round(liters * pricePerLiter * 100);
    try {
      await api<{ id: string }>('/api/fuel-logs', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: selectedVehicleId,
          logDate: logForm.logDate,
          odometerKm,
          litersMicros: Math.round(liters * 1_000_000),
          pricePerLiterSatang: Math.round(pricePerLiter * 100),
          totalSatang,
          station: logForm.station || undefined,
          note: logForm.note || undefined,
        }),
      });
      setLogForm({ logDate: today(), odometerKm: '', liters: '', pricePerLiter: '', station: '', note: '' });
      setShowLogForm(false);
      setNotice('');
      await loadLogs(selectedVehicleId);
    } catch (e) { setNotice(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'); }
  };

  const handleDeleteLog = async (logId: string) => {
    if (!confirm('ต้องการลบบันทึกนี้?')) return;
    try { await api(`/api/fuel-logs/${logId}`, { method: 'DELETE' }); await loadLogs(selectedVehicleId); } catch (e) { setNotice(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'); }
  };

  const handleDeleteVehicle = async (vehicleId: string) => {
    if (!confirm('ต้องการลบรถยนต์และบันทึกน้ำมันทั้งหมด?')) return;
    try {
      await api(`/api/vehicles/${vehicleId}`, { method: 'DELETE' });
      setSelectedVehicleId('');
      setLogs([]);
      setStats(null);
      await loadVehicles();
    } catch (e) { setNotice(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'); }
  };

  return (
    <section className="view-section">
      <div className="section-header-row">
        <button className="back-btn" onClick={onBack}>←</button>
        <h2 className="section-title">⛽ บันทึกค่าน้ำมัน</h2>
        <button className="btn-primary" style={{ fontSize: '13px', padding: '6px 14px' }} onClick={() => setShowLogForm(!showLogForm)}>
          {showLogForm ? 'ยกเลิก' : '+ บันทึก'}
        </button>
      </div>

      {notice && <div className="notice-box error">{notice}</div>}

      {/* Vehicle selector */}
      <div className="card-section" style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>เลือกรถ:</span>
          {vehicles.map(v => (
            <button
              key={v.id}
              style={{
                padding: '6px 14px', borderRadius: '20px', border: '1.5px solid', fontSize: '13px', cursor: 'pointer', fontWeight: 600,
                borderColor: selectedVehicleId === v.id ? 'var(--brand-blue)' : 'var(--border-color)',
                background: selectedVehicleId === v.id ? 'var(--brand-blue)' : 'transparent',
                color: selectedVehicleId === v.id ? '#fff' : 'var(--text-primary)',
              }}
              onClick={() => setSelectedVehicleId(v.id)}
            >
              🚗 {v.name}
            </button>
          ))}
          <button
            style={{ padding: '6px 12px', borderRadius: '20px', border: '1.5px dashed var(--border-color)', fontSize: '13px', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
            onClick={() => setShowVehicleForm(!showVehicleForm)}
          >
            + เพิ่มรถ
          </button>
        </div>
        {showVehicleForm && (
          <form onSubmit={e => void handleAddVehicle(e)} style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <input className="form-control" type="text" placeholder="ชื่อรถ เช่น Honda Civic, Toyota Yaris" value={vehicleName} onChange={e => setVehicleName(e.target.value)} required style={{ flex: 1 }} />
            <button className="btn-primary" type="submit" style={{ whiteSpace: 'nowrap', padding: '10px 16px' }}>บันทึก</button>
          </form>
        )}
      </div>

      {/* Stats cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
          <div className="card-section" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>อัตราสิ้นเปลือง</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--brand-blue)' }}>
              {stats.kmPerLiter != null ? `${stats.kmPerLiter}` : '—'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>กม./ลิตร</div>
          </div>
          <div className="card-section" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>ต้นทุน/กม.</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--expense-red)' }}>
              {stats.thbPerKmSatang != null ? `${(stats.thbPerKmSatang / 100).toFixed(2)}` : '—'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>บาท/กม.</div>
          </div>
          <div className="card-section" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>รวมลิตร</div>
            <div style={{ fontSize: '20px', fontWeight: 800 }}>{stats.totalLiters.toFixed(2)}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>ลิตร</div>
          </div>
          <div className="card-section" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>รวมค่าน้ำมัน</div>
            <div style={{ fontSize: '20px', fontWeight: 800 }}>{money(stats.totalSpentSatang)}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>ทั้งหมด</div>
          </div>
        </div>
      )}

      {/* Add Log Form */}
      {showLogForm && selectedVehicleId && (
        <form className="card-section" onSubmit={e => void handleAddLog(e)} style={{ marginBottom: '12px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>บันทึกการเติมน้ำมัน</h3>
          <div className="form-group">
            <label className="form-label">วันที่</label>
            <input className="form-control" type="date" value={logForm.logDate} onChange={e => setLogForm(f => ({ ...f, logDate: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">เลขไมล์ (กม.)</label>
            <input className="form-control" type="number" min="0" placeholder="เช่น 45230" value={logForm.odometerKm} onChange={e => setLogForm(f => ({ ...f, odometerKm: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">จำนวนลิตร</label>
            <input className="form-control" type="number" min="0.1" step="0.01" placeholder="เช่น 40.5" value={logForm.liters} onChange={e => setLogForm(f => ({ ...f, liters: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">ราคาต่อลิตร (บาท)</label>
            <input className="form-control" type="number" min="0.01" step="0.01" placeholder="เช่น 42.50" value={logForm.pricePerLiter} onChange={e => setLogForm(f => ({ ...f, pricePerLiter: e.target.value }))} required />
          </div>
          {logForm.liters && logForm.pricePerLiter && (
            <div className="notice-box info" style={{ marginBottom: '8px' }}>
              💰 ยอดรวม: {money(Math.round(parseFloat(logForm.liters) * parseFloat(logForm.pricePerLiter) * 100))}
            </div>
          )}
          <div className="form-group">
            <label className="form-label">ปั๊มน้ำมัน (ไม่บังคับ)</label>
            <input className="form-control" type="text" placeholder="เช่น PTT, Shell, Esso" value={logForm.station} onChange={e => setLogForm(f => ({ ...f, station: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">หมายเหตุ (ไม่บังคับ)</label>
            <input className="form-control" type="text" placeholder="บันทึกเพิ่มเติม" value={logForm.note} onChange={e => setLogForm(f => ({ ...f, note: e.target.value }))} />
          </div>
          <button className="btn-primary" type="submit" style={{ width: '100%', marginTop: '8px' }}>⛽ บันทึกการเติมน้ำมัน</button>
        </form>
      )}

      {!selectedVehicleId && vehicles.length === 0 && (
        <div className="empty-placeholder">
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🚗</div>
          <div>ยังไม่มีรถยนต์</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px' }}>กดปุ่ม "+ เพิ่มรถ" เพื่อเพิ่มรถยนต์ของคุณ</div>
        </div>
      )}

      {/* Fuel log list */}
      {loading && <div className="empty-placeholder">กำลังโหลด...</div>}
      {!loading && selectedVehicleId && logs.length === 0 && (
        <div className="empty-placeholder">
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>⛽</div>
          <div>ยังไม่มีบันทึกการเติมน้ำมัน</div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {logs.map(log => (
          <div key={log.id} className="card-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '4px' }}>
                  ⛽ {formatThaiDateTime(log.log_date)} {log.station ? `• ${log.station}` : ''}
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--expense-red)' }}>{money(log.total_satang)}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {(log.liters_micros / 1_000_000).toFixed(2)} ลิตร •
                  {money(log.price_per_liter_satang)}/ลิตร •
                  ไมล์: {log.odometer_km.toLocaleString('th-TH')} กม.
                </div>
                {log.note && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{log.note}</div>}
              </div>
              <button
                style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '8px', border: '1.5px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
                onClick={() => void handleDeleteLog(log.id)}
              >
                ลบ
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Delete vehicle */}
      {selectedVehicleId && (
        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <button
            style={{ fontSize: '12px', color: 'var(--expense-red)', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => void handleDeleteVehicle(selectedVehicleId)}
          >
            ลบรถยนต์คันนี้ทั้งหมด
          </button>
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------
// 12. Export CSV Helper (Frontend)
// --------------------------------------------------------------------------
function ExportButton({ month: monthParam }: { month?: string }) {
  const handleExport = async () => {
    const url = monthParam ? `/api/export/csv?month=${monthParam}` : '/api/export/csv';
    const { getToken } = await import('./api');
    const token = getToken();
    const base = import.meta.env.VITE_API_BASE ?? '';
    const res = await fetch(`${base}${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) { alert('ส่งออกข้อมูลไม่สำเร็จ'); return; }
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = monthParam ? `รายการ_${monthParam}.csv` : 'รายการทั้งหมด.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <button
      className="btn-secondary"
      style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '8px 14px' }}
      onClick={() => void handleExport()}
      title={monthParam ? `ดาวน์โหลด CSV เดือน ${monthParam}` : 'ดาวน์โหลด CSV ทั้งหมด'}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      ส่งออก CSV
    </button>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
