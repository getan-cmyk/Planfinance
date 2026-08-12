import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, getToken, setToken } from './api';
import './styles.css';

type Theme = 'light' | 'dark';
type Tab = 'dashboard' | 'transactions' | 'reports' | 'settings' | 'entry';
type Dashboard = { month:string; incomeSatang:number; expenseSatang:number; availableSatang:number; liquidSatang:number; reservedSatang:number; savingsRate:number; emergencyCoverageMonths:number|null };
type Account = { id:string; name:string; type:string; balance_satang:number };
type Category = { id:string; name:string; kind:'income'|'expense'; icon?:string; color?:string; is_default?:number };
type Budget = { id:string; category_name:string; amount_satang:number; used_satang:number };
type Transaction = { id:string; type:string; amount_satang:number; description?:string; payment_method?:string; tags_json?:string; transaction_date:string; category_name?:string; category_icon?:string; category_color?:string; account_name:string; category_id?:string; account_id:string };
type CategoryReport = { id:string; name:string; icon?:string; color?:string; amount_satang:number; transaction_count:number };
type MonthlyReport = { month:string; summary:{ incomeSatang:number; expenseSatang:number; transactionCount:number }; categories:CategoryReport[]; trend:{month:string;income_satang:number;expense_satang:number}[]; previousExpenseSatang:number };
type YearlyReport = { year:string; months:{month:string;income_satang:number;expense_satang:number}[]; categories:CategoryReport[] };

declare global { interface Window { Telegram?: { WebApp?: { initData?:string; ready?:()=>void; expand?:()=>void } } } }

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => today().slice(0, 7);
const money = (satang:number) => new Intl.NumberFormat('th-TH', { style:'currency', currency:'THB', maximumFractionDigits:0 }).format(satang / 100);
const number = (satang:number) => new Intl.NumberFormat('th-TH', { maximumFractionDigits:0 }).format(satang / 100);
const monthLabel = (value:string) => { const [y,m] = value.split('-'); return `${Number(m)}/${y}`; };
const monthNames = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const parseTags = (value?:string) => { try { const parsed:unknown = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } };

function App() {
  const [ready, setReady] = useState(!!getToken());
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('finance.theme') as Theme | null) ?? 'light');
  const [tab, setTab] = useState<Tab>('dashboard');
  const [dashboard, setDashboard] = useState<Dashboard|null>(null);
  const [report, setReport] = useState<MonthlyReport|null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Transaction|null>(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { document.body.dataset.theme = theme; localStorage.setItem('finance.theme', theme); }, [theme]);
  useEffect(() => { window.Telegram?.WebApp?.ready?.(); window.Telegram?.WebApp?.expand?.(); }, []);

  const loadData = async () => {
    setLoading(true); setNotice('');
    try {
      const [d, r, b, t, a, c] = await Promise.all([
        api<Dashboard>('/api/dashboard'),
        api<MonthlyReport>(`/api/reports/monthly?month=${currentMonth()}`),
        api<Budget[]>(`/api/budgets?month=${currentMonth()}`),
        api<{items:Transaction[]}>('/api/transactions?limit=100'),
        api<Account[]>('/api/accounts'),
        api<Category[]>('/api/categories'),
      ]);
      setDashboard(d); setReport(r); setBudgets(b); setTransactions(t.items); setAccounts(a); setCategories(c);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการโหลดข้อมูล'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (ready) void loadData(); }, [ready]);

  const login = async () => {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) { setNotice('โปรดเปิดแอปนี้จาก Telegram เพื่อยืนยันตัวตน'); return; }
    try { const result = await api<{token:string}>('/api/auth/telegram', { method:'POST', body:JSON.stringify({ initData }) }); setToken(result.token); setReady(true); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'เข้าสู่ระบบไม่สำเร็จ'); }
  };
  const afterMutation = async () => { setEditing(null); setTab('dashboard'); await loadData(); };

  if (!ready) return <main className="auth-page"><div className="brand-mark">฿</div><h1>เงินของฉัน</h1><p>บันทึก วิเคราะห์ และเข้าใจพฤติกรรมการใช้เงินของคุณ</p><button className="button primary" onClick={() => void login()}>เปิดใช้งานผ่าน Telegram</button>{notice && <p className="notice error">{notice}</p>}</main>;

  return <div className="app-shell">
    <header className="topbar"><div><span className="eyebrow">PERSONAL FINANCE</span><h1>เงินของฉัน</h1></div><div className="header-actions"><button className="icon-button" aria-label="เปลี่ยนธีม" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '☾' : '☀'}</button><button className="icon-button" aria-label="โหลดข้อมูลใหม่" onClick={() => void loadData()}>{loading ? '…' : '↻'}</button></div></header>
    {notice && <div className="notice error">{notice}</div>}
    {tab === 'dashboard' && <DashboardView dashboard={dashboard} report={report} budgets={budgets} onAdd={() => { setEditing(null); setTab('entry'); }} />}
    {tab === 'transactions' && <TransactionsView items={transactions} categories={categories} onAdd={() => { setEditing(null); setTab('entry'); }} onEdit={item => { setEditing(item); setTab('entry'); }} onDeleted={() => void loadData()} />}
    {tab === 'reports' && <ReportsView initial={report} />}
    {tab === 'settings' && <SettingsView theme={theme} setTheme={setTheme} categories={categories} accounts={accounts} onChanged={() => void loadData()} />}
    {tab === 'entry' && <EntryView editing={editing} accounts={accounts} categories={categories} onCancel={() => { setEditing(null); setTab('dashboard'); }} onDone={() => void afterMutation()} />}
    <BottomNav tab={tab} onChange={setTab} onAdd={() => { setEditing(null); setTab('entry'); }} />
  </div>;
}

function DashboardView({ dashboard, report, budgets, onAdd }:{ dashboard:Dashboard|null; report:MonthlyReport|null; budgets:Budget[]; onAdd:()=>void }) {
  if (!dashboard) return <div className="empty-state">กำลังโหลดข้อมูล…</div>;
  const top = report?.categories.filter(item => item.amount_satang > 0).sort((a,b) => b.amount_satang - a.amount_satang)[0];
  const over = budgets.filter(item => item.used_satang > item.amount_satang);
  const previousDelta = report && report.previousExpenseSatang > 0 ? Math.round(((dashboard.expenseSatang - report.previousExpenseSatang) / report.previousExpenseSatang) * 100) : null;
  const insights = [
    top ? `หมวด ${top.name} ใช้สูงสุดในเดือนนี้ที่ ${money(top.amount_satang)}` : 'เริ่มบันทึกรายการเพื่อดูหมวดที่ใช้จ่ายสูงสุด',
    over.length ? `มี ${over.length} หมวดที่ใช้เกินงบ ควรตรวจสอบก่อนเพิ่มรายการ` : 'ยังไม่มีหมวดที่ใช้เกินงบในเดือนนี้',
    previousDelta === null ? 'เมื่อมีข้อมูลเดือนก่อน ระบบจะแสดงแนวโน้มการเปลี่ยนแปลงให้' : previousDelta > 0 ? `รายจ่ายเพิ่มขึ้น ${previousDelta}% จากเดือนก่อน ควรตรวจสอบหมวดที่เพิ่มขึ้น` : `รายจ่ายลดลง ${Math.abs(previousDelta)}% จากเดือนก่อน แนวโน้มดีขึ้น`,
  ];
  return <section className="page-section">
    <section className="hero-card"><div><span>เงินใช้ได้</span><strong>{money(dashboard.availableSatang)}</strong><small>เงินสด/บัญชี {money(dashboard.liquidSatang)} · กันไว้ {money(dashboard.reservedSatang)}</small></div><button className="button hero-button" onClick={onAdd}>+ บันทึกรายการ</button></section>
    <section className="metric-grid"><Metric label="รายรับเดือนนี้" value={money(dashboard.incomeSatang)} tone="income" /><Metric label="รายจ่ายเดือนนี้" value={money(dashboard.expenseSatang)} tone="expense" /><Metric label="ยอดสุทธิ" value={money(dashboard.incomeSatang - dashboard.expenseSatang)} tone={dashboard.incomeSatang >= dashboard.expenseSatang ? 'income' : 'expense'} /><Metric label="อัตราการออม" value={`${dashboard.savingsRate}%`} tone="info" /></section>
    <section className="panel"><div className="panel-heading"><div><span className="eyebrow">MONTHLY PLAN</span><h2>สถานะงบประมาณ</h2></div><span className="pill">{monthLabel(dashboard.month)}</span></div>{budgets.length ? budgets.map(item => <BudgetRow item={item} key={item.id} />) : <Empty text="ยังไม่มีงบประมาณเดือนนี้" />}</section>
    <section className="panel"><div className="panel-heading"><div><span className="eyebrow">INSIGHT</span><h2>สิ่งที่ควรจับตา</h2></div><span className="badge purple">วิเคราะห์จากข้อมูลจริง</span></div><div className="insight-list">{insights.map((text,index) => <div className="insight" key={text}><span className={`insight-icon ${index === 1 && over.length ? 'warn' : ''}`}>{index === 0 ? '◔' : index === 1 ? '!' : '↗'}</span><p>{text}</p></div>)}</div></section>
    {report && <section className="panel"><div className="panel-heading"><div><span className="eyebrow">TREND</span><h2>รายรับเทียบรายจ่าย</h2></div><span className="badge blue">6 เดือน</span></div><TrendChart data={report.trend} /></section>}
  </section>;
}

function Metric({ label, value, tone }:{ label:string; value:string; tone:'income'|'expense'|'info' }) { return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong></article>; }
function BudgetRow({ item }:{ item:Budget }) { const ratio = item.amount_satang ? item.used_satang / item.amount_satang * 100 : 0; return <div className="budget-row"><div><b>{item.category_name}</b><span className={ratio > 100 ? 'text-danger' : ''}>{money(item.used_satang)} / {money(item.amount_satang)}</span></div><div className="progress"><i className={ratio > 100 ? 'danger' : ''} style={{ width:`${Math.min(100, ratio)}%` }} /></div></div>; }

function TransactionsView({ items, categories, onAdd, onEdit, onDeleted }:{ items:Transaction[]; categories:Category[]; onAdd:()=>void; onEdit:(item:Transaction)=>void; onDeleted:()=>void }) {
  const [search,setSearch] = useState(''); const [month,setMonth] = useState(currentMonth()); const [type,setType] = useState('all'); const [category,setCategory] = useState('all');
  const filtered = useMemo(() => items.filter(item => (!month || item.transaction_date.startsWith(month)) && (type === 'all' || item.type === type) && (category === 'all' || item.category_id === category) && (!search || `${item.description ?? ''} ${item.category_name ?? ''} ${item.payment_method ?? ''}`.toLowerCase().includes(search.toLowerCase()))), [items,month,type,category,search]);
  const remove = async (item:Transaction) => { if (!window.confirm('ลบรายการนี้หรือไม่?')) return; try { await api(`/api/transactions/${item.id}`, { method:'DELETE' }); onDeleted(); } catch (error) { window.alert(error instanceof Error ? error.message : 'ลบรายการไม่สำเร็จ'); } };
  return <section className="page-section"><div className="section-title"><div><span className="eyebrow">LEDGER</span><h2>รายการทั้งหมด</h2></div><button className="button primary small" onClick={onAdd}>+ เพิ่มรายการ</button></div><div className="filters"><input className="input" placeholder="ค้นหารายการ…" value={search} onChange={e=>setSearch(e.target.value)} /><input className="input" type="month" value={month} onChange={e=>setMonth(e.target.value)} /><select className="input" value={type} onChange={e=>setType(e.target.value)}><option value="all">ทุกประเภท</option><option value="income">รายรับ</option><option value="expense">รายจ่าย</option></select><select className="input" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">ทุกหมวดหมู่</option>{categories.map(item=><option value={item.id} key={item.id}>{item.icon ?? '•'} {item.name}</option>)}</select></div><div className="list-card">{filtered.length ? filtered.map(item => <TransactionRow item={item} key={item.id} onEdit={()=>onEdit(item)} onDelete={()=>void remove(item)} />) : <Empty text="ไม่พบรายการตามตัวกรอง" />}</div></section>;
}
function TransactionRow({ item, onEdit, onDelete }:{ item:Transaction; onEdit:()=>void; onDelete:()=>void }) { const income = ['income','refund','interest','dividend','investment_sell'].includes(item.type); return <article className="transaction-row"><div className="transaction-icon" style={{ background:`${item.category_color ?? '#0EA5E9'}18`, color:item.category_color ?? '#0EA5E9' }}>{item.category_icon ?? (income ? '↗' : '↘')}</div><div className="transaction-main"><b>{item.category_name ?? item.type}</b><span>{item.description || item.payment_method || item.account_name} · {item.transaction_date}</span></div><strong className={income ? 'amount-income' : 'amount-expense'}>{income ? '+' : '-'}{money(item.amount_satang)}</strong><div className="row-actions"><button onClick={onEdit} aria-label="แก้ไข">แก้ไข</button><button onClick={onDelete} aria-label="ลบ">ลบ</button></div></article>; }

function EntryView({ editing, accounts, categories, onCancel, onDone }:{ editing:Transaction|null; accounts:Account[]; categories:Category[]; onCancel:()=>void; onDone:()=>void }) {
  const [type,setType] = useState<'income'|'expense'>(editing?.type === 'income' ? 'income' : 'expense'); const [saving,setSaving] = useState(false); const [error,setError] = useState(''); const [form,setForm] = useState({ amount:editing ? String(editing.amount_satang / 100) : '', category:editing?.category_id ?? categories.find(c=>c.kind===type)?.id ?? '', account:editing?.account_id ?? accounts[0]?.id ?? '', description:editing?.description ?? '', payment:editing?.payment_method ?? '', tags:parseTags(editing?.tags_json).join(', '), date:editing?.transaction_date ?? today() });
  const activeCategories = categories.filter(item => item.kind === type);
  const updateType = (next:'income'|'expense') => { setType(next); setForm(previous => ({ ...previous, category:categories.find(c=>c.kind===next)?.id ?? '' })); };
  const submit = async (event:FormEvent) => { event.preventDefault(); setSaving(true); setError(''); try { const payload={ type, amountSatang:Math.round(Number(form.amount)*100), categoryId:form.category || null, accountId:form.account, description:form.description || undefined, paymentMethod:form.payment || undefined, tags:form.tags.split(',').map(value=>value.trim()).filter(Boolean), transactionDate:form.date }; await api(editing ? `/api/transactions/${editing.id}` : '/api/transactions', { method:editing ? 'PATCH' : 'POST', body:JSON.stringify(payload) }); await onDone(); } catch (error) { setError(error instanceof Error ? error.message : 'บันทึกรายการไม่สำเร็จ'); } finally { setSaving(false); } };
  return <section className="page-section"><div className="section-title"><div><span className="eyebrow">NEW TRANSACTION</span><h2>{editing ? 'แก้ไขรายการ' : 'บันทึกรายการ'}</h2></div><button className="icon-button" onClick={onCancel}>×</button></div><form className="form-card" onSubmit={event=>void submit(event)}><div className="segmented"><button type="button" className={type==='expense' ? 'selected expense' : ''} onClick={()=>updateType('expense')}>↘ รายจ่าย</button><button type="button" className={type==='income' ? 'selected income' : ''} onClick={()=>updateType('income')}>↗ รายรับ</button></div><label>จำนวนเงิน<input className="input amount-input" type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} required autoFocus /></label><label>หมวดหมู่<select className="input" value={form.category} onChange={e=>setForm({...form,category:e.target.value})} required>{activeCategories.map(item=><option value={item.id} key={item.id}>{item.icon ?? '•'} {item.name}</option>)}</select></label><label>บัญชีที่ใช้<select className="input" value={form.account} onChange={e=>setForm({...form,account:e.target.value})} required>{accounts.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><div className="form-grid"><label>วันที่<input className="input" type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})} required /></label><label>ช่องทาง<select className="input" value={form.payment} onChange={e=>setForm({...form,payment:e.target.value})}><option value="">ไม่ระบุ</option><option>เงินสด</option><option>บัตรเครดิต</option><option>โอนเงิน</option><option>QR พร้อมเพย์</option><option>อื่น ๆ</option></select></label></div><label>รายละเอียด<input className="input" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} maxLength={500} placeholder={type==='expense' ? 'ซื้ออะไร ที่ไหน?' : 'รายรับจากอะไร?'} /></label><label>Tags<input className="input" value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})} placeholder="เช่น จำเป็น, งาน, ครอบครัว" /></label>{error && <div className="notice error">{error}</div>}<div className="form-actions"><button type="button" className="button secondary" onClick={onCancel}>ยกเลิก</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'กำลังบันทึก…' : editing ? 'บันทึกการแก้ไข' : `บันทึก${type==='expense' ? 'รายจ่าย' : 'รายรับ'}`}</button></div></form></section>;
}

function ReportsView({ initial }:{ initial:MonthlyReport|null }) {
  const [mode,setMode] = useState<'monthly'|'yearly'>('monthly'); const [month,setMonth] = useState(currentMonth()); const [year,setYear] = useState(String(new Date().getFullYear())); const [monthly,setMonthly] = useState<MonthlyReport|null>(initial); const [yearly,setYearly] = useState<YearlyReport|null>(null); const [loading,setLoading] = useState(false);
  useEffect(() => { let active=true; setLoading(true); const path=mode==='monthly' ? `/api/reports/monthly?month=${month}` : `/api/reports/yearly?year=${year}`; void api<MonthlyReport|YearlyReport>(path).then(data=>{if(!active){return;} if(mode==='monthly')setMonthly(data as MonthlyReport);else setYearly(data as YearlyReport);}).catch(()=>undefined).finally(()=>{if(active)setLoading(false)}); return ()=>{active=false}; }, [mode,month,year]);
  const activeCategories = (mode==='monthly' ? monthly?.categories : yearly?.categories)?.filter(item=>item.amount_satang>0) ?? []; const totalExpense = activeCategories.reduce((sum,item)=>sum+item.amount_satang,0);
  return <section className="page-section"><div className="section-title"><div><span className="eyebrow">REPORTS & ANALYSIS</span><h2>รายงานการเงิน</h2></div><span className="badge purple">ตัวเลขจาก D1</span></div><div className="report-tabs"><button className={mode==='monthly' ? 'active' : ''} onClick={()=>setMode('monthly')}>รายเดือน</button><button className={mode==='yearly' ? 'active' : ''} onClick={()=>setMode('yearly')}>รายปี</button></div>{mode==='monthly' ? <><input className="input report-picker" type="month" value={month} onChange={e=>setMonth(e.target.value)} />{monthly && <><div className="metric-grid report-metrics"><Metric label="รายรับ" value={money(monthly.summary.incomeSatang)} tone="income" /><Metric label="รายจ่าย" value={money(monthly.summary.expenseSatang)} tone="expense" /><Metric label="ยอดสุทธิ" value={money(monthly.summary.incomeSatang-monthly.summary.expenseSatang)} tone={monthly.summary.incomeSatang>=monthly.summary.expenseSatang?'income':'expense'} /><Metric label="รายการ" value={String(monthly.summary.transactionCount)} tone="info" /></div><ReportCategories categories={activeCategories} total={totalExpense} /><div className="panel"><div className="panel-heading"><h2>แนวโน้มย้อนหลัง 6 เดือน</h2><span className="badge blue">รายรับ / รายจ่าย</span></div><TrendChart data={monthly.trend} /></div></>}</> : <><select className="input report-picker" value={year} onChange={e=>setYear(e.target.value)}>{[0,1,2,3,4].map(offset=><option key={offset}>{Number(year)-offset}</option>)}</select>{yearly && <><div className="metric-grid report-metrics"><Metric label="รายรับทั้งปี" value={money(yearly.months.reduce((sum,item)=>sum+item.income_satang,0))} tone="income" /><Metric label="รายจ่ายทั้งปี" value={money(yearly.months.reduce((sum,item)=>sum+item.expense_satang,0))} tone="expense" /></div><ReportCategories categories={activeCategories} total={totalExpense} /><div className="panel"><div className="panel-heading"><h2>รายเดือนในปี {year}</h2></div><TrendChart data={yearly.months} /></div></>}</>}{loading && <p className="loading-line">กำลังโหลดรายงาน…</p>}</section>;
}
function ReportCategories({ categories, total }:{ categories:CategoryReport[]; total:number }) { return <div className="panel"><div className="panel-heading"><div><span className="eyebrow">CATEGORY BREAKDOWN</span><h2>รายจ่ายตามหมวดหมู่</h2></div><span className="badge orange">{money(total)}</span></div>{categories.length ? <div className="category-report"><Donut categories={categories} total={total} /><div className="category-list">{categories.map(item=>{const percent=total ? Math.round(item.amount_satang/total*100) : 0; return <div className="category-item" key={item.id}><div><span className="color-dot" style={{background:item.color ?? '#64748B'}} />{item.icon ?? '•'} {item.name}</div><strong>{money(item.amount_satang)} <small>{percent}%</small></strong></div>})}</div></div> : <Empty text="ยังไม่มีข้อมูลค่าใช้จ่ายในช่วงนี้" />}</div>; }
function Donut({ categories, total }:{ categories:CategoryReport[]; total:number }) { let cursor=0; const stops=categories.map(item=>{const start=cursor;cursor+=total ? item.amount_satang/total*100 : 0;return `${item.color ?? '#64748B'} ${start}% ${cursor}%`;}).join(', '); return <div className="donut-wrap"><div className="donut" style={{background:categories.length ? `conic-gradient(${stops})` : '#e5e7eb'}}><div><strong>{money(total)}</strong><span>รวม</span></div></div></div>; }
function TrendChart({ data }:{ data:{month:string;income_satang?:number;expense_satang?:number}[] }) { const max=Math.max(1,...data.flatMap(item=>[item.income_satang ?? 0,item.expense_satang ?? 0])); return <div className="trend-chart">{data.map(item=><div className="trend-column" key={item.month}><div className="bars"><i className="bar income" style={{height:`${Math.max(item.income_satang ? 4 : 0,(item.income_satang ?? 0)/max*100)}%`}} title={`รายรับ ${money(item.income_satang ?? 0)}`} /><i className="bar expense" style={{height:`${Math.max(item.expense_satang ? 4 : 0,(item.expense_satang ?? 0)/max*100)}%`}} title={`รายจ่าย ${money(item.expense_satang ?? 0)}`} /></div><span>{monthLabel(item.month).split('/')[0]}</span></div>)}</div>; }

function SettingsView({ theme, setTheme, categories, accounts, onChanged }:{ theme:Theme; setTheme:(theme:Theme)=>void; categories:Category[]; accounts:Account[]; onChanged:()=>void }) { const [kind,setKind]=useState<'expense'|'income'>('expense'); const [name,setName]=useState(''); const [saving,setSaving]=useState(false); const addCategory=async()=>{if(!name.trim())return;setSaving(true);try{await api('/api/categories',{method:'POST',body:JSON.stringify({kind,name:name.trim(),icon:kind==='expense'?'📦':'💰',color:kind==='expense'?'#F97316':'#10B981'})});setName('');onChanged()}catch(error){window.alert(error instanceof Error?error.message:'เพิ่มหมวดหมู่ไม่สำเร็จ')}finally{setSaving(false)}};return <section className="page-section"><div className="section-title"><div><span className="eyebrow">PREFERENCES</span><h2>ตั้งค่า</h2></div></div><div className="panel theme-panel"><div><span className="theme-icon">{theme==='light'?'☀':'☾'}</span><div><b>{theme==='light'?'ธีมขาวสบายตา':'ธีมมืดสบายตา'}</b><small>{theme==='light'?'พื้นหลังสว่างและสีแยกฟังก์ชันชัดเจน':'พื้นหลังเข้ม ลดแสงจ้า และยังคงสีฟังก์ชันไว้'}</small></div></div><button className="switch" onClick={()=>setTheme(theme==='light'?'dark':'light')}><span className={theme==='dark' ? 'on' : ''} /></button></div><div className="panel"><div className="panel-heading"><div><span className="eyebrow">CATEGORIES</span><h2>หมวดหมู่</h2></div></div><div className="category-chips">{categories.map(item=><span className={`category-chip ${item.kind}`} key={item.id}>{item.icon ?? '•'} {item.name}</span>)}</div><div className="add-category"><select className="input" value={kind} onChange={e=>setKind(e.target.value as 'expense'|'income')}><option value="expense">หมวดรายจ่าย</option><option value="income">หมวดรายรับ</option></select><input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="ชื่อหมวดใหม่" /><button className="button primary" disabled={saving} onClick={()=>void addCategory()}>เพิ่ม</button></div></div><div className="panel"><div className="panel-heading"><div><span className="eyebrow">ACCOUNTS</span><h2>บัญชีที่ใช้งาน</h2></div></div>{accounts.map(item=><div className="account-row" key={item.id}><span>{item.name}<small>{item.type}</small></span><strong>{money(item.balance_satang)}</strong></div>)}</div></section>; }

function BottomNav({ tab, onChange, onAdd }:{ tab:Tab; onChange:(tab:Tab)=>void; onAdd:()=>void }) { return <nav className="bottom-nav"><button className={tab==='dashboard'?'active':''} onClick={()=>onChange('dashboard')}><b>⌂</b><span>ภาพรวม</span></button><button className={tab==='transactions'?'active':''} onClick={()=>onChange('transactions')}><b>≡</b><span>รายการ</span></button><button className="fab" onClick={onAdd}>＋</button><button className={tab==='reports'?'active':''} onClick={()=>onChange('reports')}><b>◈</b><span>รายงาน</span></button><button className={tab==='settings'?'active':''} onClick={()=>onChange('settings')}><b>⚙</b><span>ตั้งค่า</span></button></nav>; }
const Empty=({text}:{text:string})=><p className="empty-state">{text}</p>;
createRoot(document.getElementById('root')!).render(<App />);
