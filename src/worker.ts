import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { verifyTelegramInitData } from './lib/auth';
import { emergencyCoverage, portfolioAllocation, savingsRate } from './lib/finance';

type Env = { DB: D1Database; TELEGRAM_BOT_TOKEN: string; SESSION_SECRET: string; APP_ORIGIN: string; TELEGRAM_AUTH_MAX_AGE_SECONDS?: string };
type Vars = { userId: number };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();
const id = () => crypto.randomUUID(); const now = () => new Date().toISOString(); const month = () => now().slice(0, 7);
const ok = (c: any, data: unknown, status = 200) => c.json({ success: true, data }, status);
const fail = (c: any, code: string, message: string, status = 400) => c.json({ success: false, error: { code, message } }, status);
app.use('/api/*', cors({ origin: (origin, c) => origin === c.env.APP_ORIGIN ? origin : c.env.APP_ORIGIN, allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
app.onError((err, c) => { console.error(JSON.stringify({ event: 'api_error', message: err.message })); return fail(c, 'INTERNAL_ERROR', 'Unexpected server error', 500); });

async function sign(value: string, secret: string) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
async function sessionFor(userId: number, secret: string) { const payload = btoa(JSON.stringify({ userId, exp: Date.now() + 86_400_000 })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); return `${payload}.${await sign(payload, secret)}`; }
async function verifySession(token: string, secret: string): Promise<number | null> { const [payload, signature] = token.split('.'); if (!payload || !signature || signature !== await sign(payload, secret)) return null; try { const data = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/'))) as { userId: number; exp: number }; return data.exp > Date.now() ? data.userId : null; } catch { return null; } }
app.use('/api/*', async (c, next) => { if (c.req.path === '/api/auth/telegram' || c.req.path === '/api/telegram/webhook') return next(); const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, ''); const userId = token ? await verifySession(token, c.env.SESSION_SECRET) : null; if (!userId) return fail(c, 'UNAUTHORIZED', 'Sign in through Telegram to continue', 401); c.set('userId', userId); await next(); });
async function audit(db: D1Database, userId: number, action: string, entity: string, entityId?: string) { await db.prepare('INSERT INTO audit_logs (id,user_id,action,entity,entity_id) VALUES (?,?,?,?,?)').bind(id(), userId, action, entity, entityId ?? null).run(); }
async function seedUser(db: D1Database, userId: number) { const count = await db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE user_id=?').bind(userId).first<{ n: number }>(); if (count?.n) return; const accountId = id(); await db.batch([
  db.prepare('INSERT INTO accounts (id,user_id,name,type,balance_satang) VALUES (?,?,?,?,?)').bind(accountId,userId,'บัญชีหลัก','bank',0),
  ...[['Salary','income'],['Other Income','income'],['Food','expense'],['Fuel','expense'],['Utilities','expense'],['Home Internet','expense'],['Mobile Internet','expense'],['Family','expense'],['Vehicle','expense'],['Shopping','expense'],['Personal','expense'],['Maintenance','expense'],['Health','expense'],['Entertainment','expense'],['Travel','expense'],['Other','expense']].map(([name,kind]) => db.prepare('INSERT INTO categories (id,user_id,kind,name,is_default) VALUES (?,?,?,?,1)').bind(id(),userId,kind,name)),
  db.prepare('INSERT INTO sinking_funds (id,user_id,name,target_satang,current_satang,monthly_contribution_satang,due_date) VALUES (?,?,?,?,?,?,?)').bind(id(),userId,'ประกันรถ',500000,0,100000,new Date(new Date().setMonth(new Date().getMonth()+5)).toISOString().slice(0,10)),
  db.prepare('INSERT INTO sinking_funds (id,user_id,name,target_satang,current_satang,monthly_contribution_satang,due_date) VALUES (?,?,?,?,?,?,?)').bind(id(),userId,'ภาษี + พ.ร.บ.',150000,0,12500,new Date(new Date().setFullYear(new Date().getFullYear()+1)).toISOString().slice(0,10)),
  ...[['Food',280000],['Utilities',20000],['Home Internet',50000],['Mobile Internet',20000],['Fuel',575000],['Family',150000],['Vehicle',100000],['Shopping',200000]].map(([name,amount]) => db.prepare("INSERT INTO budgets (id,user_id,category_id,month,amount_satang) SELECT ?,?,id,?,? FROM categories WHERE user_id=? AND name=?").bind(id(),userId,month(),amount,userId,name)),
  ...[['stock',6000,null],['gold',2500,null],['crypto',1500,1500]].map(([asset,target,max]) => db.prepare('INSERT INTO portfolio_targets (user_id,asset_class,target_percent_basis_points,max_percent_basis_points) VALUES (?,?,?,?)').bind(userId,asset,target,max))
 ]); }

app.post('/api/auth/telegram', async c => { const body = z.object({ initData: z.string().min(1) }).parse(await c.req.json()); const telegram = await verifyTelegramInitData(body.initData, c.env.TELEGRAM_BOT_TOKEN, Number(c.env.TELEGRAM_AUTH_MAX_AGE_SECONDS ?? 86400)); await c.env.DB.prepare('INSERT INTO users (telegram_id,first_name,username) VALUES (?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET first_name=excluded.first_name,username=excluded.username,updated_at=CURRENT_TIMESTAMP').bind(String(telegram.id), telegram.first_name ?? null, telegram.username ?? null).run(); const user = await c.env.DB.prepare('SELECT * FROM users WHERE telegram_id=?').bind(String(telegram.id)).first<{ id:number }>(); if (!user) return fail(c,'AUTH_FAILED','Unable to establish user',401); await seedUser(c.env.DB,user.id); await audit(c.env.DB,user.id,'login','user',String(user.id)); return ok(c,{ token: await sessionFor(user.id,c.env.SESSION_SECRET) }); });
app.get('/api/me', async c => ok(c, await c.env.DB.prepare('SELECT id,telegram_id,first_name,username,currency FROM users WHERE id=?').bind(c.get('userId')).first()));
app.get('/api/categories', async c => ok(c, (await c.env.DB.prepare('SELECT * FROM categories WHERE user_id=? ORDER BY kind,name').bind(c.get('userId')).all()).results));
const categorySchema = z.object({ kind: z.enum(['income','expense']), name: z.string().min(1).max(80), icon: z.string().max(8).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });
app.post('/api/categories', async c => { const b = categorySchema.parse(await c.req.json()); const u = c.get('userId'); const entity = id(); await c.env.DB.prepare('INSERT INTO categories (id,user_id,kind,name,icon,color,is_default) VALUES (?,?,?,?,?,?,0)').bind(entity,u,b.kind,b.name,b.icon ?? '📦',b.color ?? '#64748B').run(); await audit(c.env.DB,u,'create','category',entity); return ok(c,{id:entity},201); });
app.delete('/api/categories/:id', async c => { const u=c.get('userId'), entity=c.req.param('id'); const cat=await c.env.DB.prepare('SELECT id FROM categories WHERE id=? AND user_id=?').bind(entity,u).first<{id:string}>(); if(!cat)return fail(c,'NOT_FOUND','Category not found',404); await c.env.DB.batch([c.env.DB.prepare('DELETE FROM budgets WHERE category_id=? AND user_id=?').bind(entity,u),c.env.DB.prepare('DELETE FROM categories WHERE id=? AND user_id=?').bind(entity,u)]); await audit(c.env.DB,u,'delete','category',entity); return ok(c,{id:entity}); });
app.get('/api/accounts', async c => ok(c, (await c.env.DB.prepare('SELECT * FROM accounts WHERE user_id=? ORDER BY active DESC,name').bind(c.get('userId')).all()).results));
const accountSchema = z.object({ name:z.string().min(1).max(80), type:z.enum(['cash','bank','ewallet','investment','crypto']), currency:z.string().length(3).default('THB') });
app.post('/api/accounts', async c => { const b=accountSchema.extend({balanceSatang:z.number().int().default(0)}).parse(await c.req.json()); const entity=id(); await c.env.DB.prepare('INSERT INTO accounts (id,user_id,name,type,balance_satang,currency) VALUES (?,?,?,?,?,?)').bind(entity,c.get('userId'),b.name,b.type,b.balanceSatang,b.currency).run(); await audit(c.env.DB,c.get('userId'),'create','account',entity); return ok(c,{id:entity},201); });
app.patch('/api/accounts/:id', async c => { const u=c.get('userId'), entity=c.req.param('id'); const existing=await c.env.DB.prepare('SELECT id FROM accounts WHERE id=? AND user_id=?').bind(entity,u).first(); if(!existing)return fail(c,'NOT_FOUND','Account not found',404); const b=accountSchema.extend({active:z.boolean().optional()}).parse(await c.req.json()); await c.env.DB.prepare('UPDATE accounts SET name=?,type=?,currency=?,active=COALESCE(?,active),updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').bind(b.name,b.type,b.currency,b.active === undefined ? null : (b.active ? 1 : 0),entity,u).run(); await audit(c.env.DB,u,'update','account',entity); return ok(c,{id:entity}); });
const transactionSchema=z.object({type:z.enum(['income','expense','transfer','investment_buy','investment_sell','dividend','interest','refund','adjustment']),amountSatang:z.number().int().positive(),categoryId:z.string().uuid().nullable().optional(),accountId:z.string().uuid(),destinationAccountId:z.string().uuid().optional(),description:z.string().max(500).optional(),paymentMethod:z.string().max(40).optional(),tags:z.array(z.string().max(30)).max(10).optional(),transactionDate:z.string().date(),idempotencyKey:z.string().max(100).optional()}).superRefine((v,ctx)=>{if(v.type==='transfer'&&!v.destinationAccountId)ctx.addIssue({code:'custom',message:'Destination account is required'});});
const accountDelta = (type:string, amount:number) => ['expense','transfer','investment_buy'].includes(type) ? -amount : amount;
async function ownsAccount(db:D1Database,userId:number,accountId:string){return !!await db.prepare('SELECT id FROM accounts WHERE id=? AND user_id=? AND active=1').bind(accountId,userId).first();}
app.get('/api/transactions', async c => { const u=c.get('userId'), p=Math.max(1,Number(c.req.query('page')??1)), limit=Math.min(100,Math.max(1,Number(c.req.query('limit')??50))), offset=(p-1)*limit, search=c.req.query('search')??'', type=c.req.query('type'), monthFilter=c.req.query('month'), categoryId=c.req.query('categoryId'); const clauses=['t.user_id=?']; const args:any[]=[u]; if(type){clauses.push('t.type=?');args.push(type);} if(monthFilter){clauses.push("substr(t.transaction_date,1,7)=?");args.push(monthFilter);} if(categoryId){clauses.push('t.category_id=?');args.push(categoryId);} if(search){clauses.push("(COALESCE(t.description,'') LIKE ? OR COALESCE(t.payment_method,'') LIKE ?)");args.push(`%${search}%`,`%${search}%`);} const sql=`SELECT t.*,c.name category_name,c.icon category_icon,c.color category_color,a.name account_name FROM transactions t LEFT JOIN categories c ON c.id=t.category_id JOIN accounts a ON a.id=t.account_id WHERE ${clauses.join(' AND ')} ORDER BY t.transaction_date DESC,t.created_at DESC LIMIT ? OFFSET ?`; const countSql=`SELECT COUNT(*) total FROM transactions t WHERE ${clauses.join(' AND ')}`; const [items,total]=await Promise.all([c.env.DB.prepare(sql).bind(...args,limit,offset).all(),c.env.DB.prepare(countSql).bind(...args).first<{total:number}>()]); return ok(c,{items:items.results,page:p,limit,total:total?.total??0}); });
app.post('/api/transactions', async c => { const b=transactionSchema.parse(await c.req.json()), u=c.get('userId'); if(!await ownsAccount(c.env.DB,u,b.accountId)||(b.destinationAccountId&&!await ownsAccount(c.env.DB,u,b.destinationAccountId)))return fail(c,'FORBIDDEN','Account does not belong to you',403); const entity=id(); const stmts=[c.env.DB.prepare('INSERT INTO transactions (id,user_id,type,amount_satang,category_id,account_id,destination_account_id,description,payment_method,tags_json,transaction_date,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(entity,u,b.type,b.amountSatang,b.categoryId??null,b.accountId,b.destinationAccountId??null,b.description??null,b.paymentMethod??null,JSON.stringify(b.tags??[]),b.transactionDate,b.idempotencyKey??null),c.env.DB.prepare('UPDATE accounts SET balance_satang=balance_satang+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').bind(accountDelta(b.type,b.amountSatang),b.accountId,u)]; if(b.type==='transfer'&&b.destinationAccountId)stmts.push(c.env.DB.prepare('UPDATE accounts SET balance_satang=balance_satang+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').bind(b.amountSatang,b.destinationAccountId,u)); await c.env.DB.batch(stmts); await audit(c.env.DB,u,'create','transaction',entity); return ok(c,{id:entity},201); });
app.patch('/api/transactions/:id', async c=>{const u=c.get('userId'),old=await c.env.DB.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?').bind(c.req.param('id'),u).first<any>();if(!old)return fail(c,'NOT_FOUND','Transaction not found',404);const b=transactionSchema.parse(await c.req.json());if(!await ownsAccount(c.env.DB,u,b.accountId)||(b.destinationAccountId&&!await ownsAccount(c.env.DB,u,b.destinationAccountId)))return fail(c,'FORBIDDEN','Account does not belong to you',403);const stmts=[c.env.DB.prepare('UPDATE accounts SET balance_satang=balance_satang-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').bind(accountDelta(old.type,old.amount_satang),old.account_id,u)];if(old.type==='transfer'&&old.destination_account_id)stmts.push(c.env.DB.prepare('UPDATE accounts SET balance_satang=balance_satang-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').bind(old.amount_satang,old.destination_account_id,u));stmts.push(c.env.DB.prepare('UPDATE transactions SET type=?,amount_satang=?,category_id=?,account_id=?,destination_account_id=?,description=?,payment_method=?,tags_json=?,transaction_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').bind(b.type,b.amountSatang,b.categoryId??null,b.accountId,b.destinationAccountId??null,b.description??null,b.paymentMethod??null,JSON.stringify(b.tags??[]),b.transactionDate,old.id,u));stmts.push(c.env.DB.prepare('UPDATE accounts SET balance_satang=balance_satang+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').bind(accountDelta(b.type,b.amountSatang),b.accountId,u));if(b.type==='transfer'&&b.destinationAccountId)stmts.push(c.env.DB.prepare('UPDATE accounts SET balance_satang=balance_satang+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').bind(b.amountSatang,b.destinationAccountId,u));await c.env.DB.batch(stmts);await audit(c.env.DB,u,'update','transaction',old.id);return ok(c,{id:old.id});});
app.delete('/api/transactions/:id', async c=>{const u=c.get('userId'), t=await c.env.DB.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?').bind(c.req.param('id'),u).first<any>(); if(!t)return fail(c,'NOT_FOUND','Transaction not found',404); const stmts=[c.env.DB.prepare('UPDATE accounts SET balance_satang=balance_satang-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').bind(accountDelta(t.type,t.amount_satang),t.account_id,u),c.env.DB.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').bind(t.id,u)];if(t.type==='transfer'&&t.destination_account_id)stmts.push(c.env.DB.prepare('UPDATE accounts SET balance_satang=balance_satang-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').bind(t.amount_satang,t.destination_account_id,u));await c.env.DB.batch(stmts);await audit(c.env.DB,u,'delete','transaction',t.id);return ok(c,{id:t.id});});
app.get('/api/budgets',async c=>{const m=c.req.query('month')??month(),u=c.get('userId');const rows=(await c.env.DB.prepare("SELECT b.*,c.name category_name,COALESCE((SELECT SUM(amount_satang) FROM transactions t WHERE t.user_id=b.user_id AND t.category_id=b.category_id AND t.type='expense' AND substr(t.transaction_date,1,7)=b.month),0) used_satang FROM budgets b JOIN categories c ON c.id=b.category_id WHERE b.user_id=? AND b.month=? ORDER BY c.name").bind(u,m).all()).results;return ok(c,rows);});
app.post('/api/budgets',async c=>{const b=z.object({categoryId:z.string().uuid(),month:z.string().regex(/^\d{4}-\d{2}$/),amountSatang:z.number().int().nonnegative()}).parse(await c.req.json()),u=c.get('userId');const cat=await c.env.DB.prepare("SELECT id FROM categories WHERE id=? AND user_id=? AND kind='expense'").bind(b.categoryId,u).first();if(!cat)return fail(c,'FORBIDDEN','Invalid category',403);await c.env.DB.prepare('INSERT INTO budgets (id,user_id,category_id,month,amount_satang) VALUES (?,?,?,?,?) ON CONFLICT(user_id,category_id,month) DO UPDATE SET amount_satang=excluded.amount_satang,updated_at=CURRENT_TIMESTAMP').bind(id(),u,b.categoryId,b.month,b.amountSatang).run();return ok(c,{});});
app.get('/api/reports/monthly',async c=>{const u=c.get('userId'),m=c.req.query('month')??month();if(!/^\d{4}-\d{2}$/.test(m))return fail(c,'VALIDATION_ERROR','Invalid month format');const summary=await c.env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN type IN ('income','refund','interest','dividend','investment_sell') THEN amount_satang ELSE 0 END),0) income_satang,COALESCE(SUM(CASE WHEN type='expense' THEN amount_satang ELSE 0 END),0) expense_satang,COUNT(*) transaction_count FROM transactions WHERE user_id=? AND substr(transaction_date,1,7)=?").bind(u,m).first<any>();const categories=(await c.env.DB.prepare("SELECT c.id,c.name,c.icon,c.color,COALESCE(SUM(t.amount_satang),0) amount_satang,COUNT(t.id) transaction_count FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.user_id=? AND t.type='expense' AND substr(t.transaction_date,1,7)=? WHERE c.user_id=? AND c.kind='expense' GROUP BY c.id,c.name,c.icon,c.color ORDER BY amount_satang DESC").bind(u,m,u).all()).results;const trend=(await c.env.DB.prepare("SELECT substr(transaction_date,1,7) month,COALESCE(SUM(CASE WHEN type IN ('income','refund','interest','dividend','investment_sell') THEN amount_satang ELSE 0 END),0) income_satang,COALESCE(SUM(CASE WHEN type='expense' THEN amount_satang ELSE 0 END),0) expense_satang FROM transactions WHERE user_id=? AND transaction_date>=date(? || '-01','-5 months') GROUP BY substr(transaction_date,1,7) ORDER BY month").bind(u,m).all()).results;const previousMonth=await c.env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN type='expense' THEN amount_satang ELSE 0 END),0) expense_satang FROM transactions WHERE user_id=? AND substr(transaction_date,1,7)=strftime('%Y-%m',date(? || '-01','-1 month'))").bind(u,m).first<{expense_satang:number}>();return ok(c,{month:m,summary:{incomeSatang:summary?.income_satang??0,expenseSatang:summary?.expense_satang??0,transactionCount:summary?.transaction_count??0},categories,trend,previousExpenseSatang:previousMonth?.expense_satang??0});});
app.get('/api/reports/yearly',async c=>{const u=c.get('userId'),year=c.req.query('year')??String(new Date().getFullYear());if(!/^\d{4}$/.test(year))return fail(c,'VALIDATION_ERROR','Invalid year format');const months=(await c.env.DB.prepare("SELECT substr(transaction_date,1,7) month,COALESCE(SUM(CASE WHEN type IN ('income','refund','interest','dividend','investment_sell') THEN amount_satang ELSE 0 END),0) income_satang,COALESCE(SUM(CASE WHEN type='expense' THEN amount_satang ELSE 0 END),0) expense_satang FROM transactions WHERE user_id=? AND substr(transaction_date,1,4)=? GROUP BY substr(transaction_date,1,7) ORDER BY month").bind(u,year).all()).results;const categories=(await c.env.DB.prepare("SELECT c.id,c.name,c.icon,c.color,COALESCE(SUM(t.amount_satang),0) amount_satang FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.user_id=? AND t.type='expense' AND substr(t.transaction_date,1,4)=? WHERE c.user_id=? AND c.kind='expense' GROUP BY c.id,c.name,c.icon,c.color ORDER BY amount_satang DESC").bind(u,year,u).all()).results;return ok(c,{year,months,categories});});
app.get('/api/dashboard',async c=>{const u=c.get('userId'),m=month();const totals=await c.env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN type IN ('income','refund','interest','dividend','investment_sell') THEN amount_satang ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='expense' THEN amount_satang ELSE 0 END),0) expenses FROM transactions WHERE user_id=? AND substr(transaction_date,1,7)=?").bind(u,m).first<{income:number;expenses:number}>();const assets=await c.env.DB.prepare('SELECT COALESCE(SUM(balance_satang),0) liquid FROM accounts WHERE user_id=? AND active=1').bind(u).first<{liquid:number}>();const reserved=await c.env.DB.prepare('SELECT COALESCE(SUM(current_satang),0) reserved FROM sinking_funds WHERE user_id=? AND active=1').bind(u).first<{reserved:number}>();const essential=await c.env.DB.prepare("SELECT COALESCE(SUM(amount_satang),0) e FROM budgets b JOIN categories c ON c.id=b.category_id WHERE b.user_id=? AND b.month=? AND c.name IN ('Food','Utilities','Home Internet','Mobile Internet','Fuel','Family')").bind(u,m).first<{e:number}>();const monthlyAvailable=(totals?.income??0)-(totals?.expenses??0);return ok(c,{month:m,incomeSatang:totals?.income??0,expenseSatang:totals?.expenses??0,availableSatang:monthlyAvailable,monthlyAvailableSatang:monthlyAvailable,liquidSatang:assets?.liquid??0,reservedSatang:reserved?.reserved??0,savingsRate:savingsRate(totals?.income??0,totals?.expenses??0),emergencyCoverageMonths:emergencyCoverage(assets?.liquid??0,essential?.e??0)});});
app.get('/api/sinking-funds',async c=>ok(c,(await c.env.DB.prepare('SELECT * FROM sinking_funds WHERE user_id=? ORDER BY active DESC,due_date').bind(c.get('userId')).all()).results));
app.post('/api/sinking-funds',async c=>{const b=z.object({name:z.string().min(1),targetSatang:z.number().int().positive(),monthlyContributionSatang:z.number().int().nonnegative(),dueDate:z.string().date().optional()}).parse(await c.req.json());const entity=id();await c.env.DB.prepare('INSERT INTO sinking_funds (id,user_id,name,target_satang,monthly_contribution_satang,due_date) VALUES (?,?,?,?,?,?)').bind(entity,c.get('userId'),b.name,b.targetSatang,b.monthlyContributionSatang,b.dueDate??null).run();return ok(c,{id:entity},201);});
app.get('/api/goals',async c=>ok(c,(await c.env.DB.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY priority,name').bind(c.get('userId')).all()).results));
app.get('/api/net-worth',async c=>{const u=c.get('userId');const accounts=await c.env.DB.prepare('SELECT type,COALESCE(SUM(balance_satang),0) value FROM accounts WHERE user_id=? GROUP BY type').bind(u).all<{type:string;value:number}>();const vehicle=await c.env.DB.prepare('SELECT COALESCE(SUM(current_value_satang),0) v FROM vehicles WHERE user_id=?').bind(u).first<{v:number}>();const assetTotal=accounts.results.reduce((a,x)=>a+x.value,vehicle?.v??0);return ok(c,{assetsSatang:assetTotal,liabilitiesSatang:0,netWorthSatang:assetTotal,breakdown:accounts.results});});
app.get('/api/portfolio',async c=>{const u=c.get('userId');const positions=await c.env.DB.prepare("SELECT a.id,a.symbol,a.name,a.asset_class,a.manual_price_satang,COALESCE(SUM(CASE WHEN i.type IN ('buy','deposit') THEN i.quantity_micros WHEN i.type IN ('sell','withdraw') THEN -i.quantity_micros ELSE 0 END),0) quantity_micros,COALESCE(SUM(CASE WHEN i.type='buy' THEN i.total_satang+i.fee_satang WHEN i.type='sell' THEN -(i.total_satang-i.fee_satang) ELSE 0 END),0) cost_satang FROM assets a LEFT JOIN investment_transactions i ON i.asset_id=a.id AND i.user_id=a.user_id WHERE a.user_id=? GROUP BY a.id").bind(u).all<any>();const valued=positions.results.map(p=>({...p,currentValueSatang:Math.round((p.quantity_micros/1_000_000)*(p.manual_price_satang??0))}));const total=valued.reduce((x,p)=>x+p.currentValueSatang,0);const targets=await c.env.DB.prepare('SELECT * FROM portfolio_targets WHERE user_id=?').bind(u).all();return ok(c,{positions:valued.map(p=>({...p,allocationPercent:portfolioAllocation(p.currentValueSatang,total)})),totalValueSatang:total,targets:targets.results});});
app.get('/api/forecast',async c=>{const u=c.get('userId'),months=Math.min(12,Math.max(1,Number(c.req.query('months')??3)));const d=await c.env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount_satang ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='expense' THEN amount_satang ELSE 0 END),0) expense FROM transactions WHERE user_id=? AND transaction_date>=date('now','-3 months')").bind(u).first<{income:number;expense:number}>();const cash=await c.env.DB.prepare('SELECT COALESCE(SUM(balance_satang),0) b FROM accounts WHERE user_id=?').bind(u).first<{b:number}>();const avgIncome=Math.round((d?.income??0)/3),avgExpense=Math.round((d?.expense??0)/3);return ok(c,{isEstimate:true,months,currentCashSatang:cash?.b??0,monthlyIncomeSatang:avgIncome,monthlyExpenseSatang:avgExpense,expectedCashSatang:(cash?.b??0)+(avgIncome-avgExpense)*months});});

// ─────────────────────────────────────────────────────────────────────────────
// Feature 2: Recurring Transactions & Subscriptions
// ─────────────────────────────────────────────────────────────────────────────
const recurringSchema = z.object({
  type: z.enum(['income','expense']),
  amountSatang: z.number().int().positive(),
  categoryId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid(),
  description: z.string().max(500).optional(),
  frequency: z.enum(['weekly','monthly','yearly','custom']).default('monthly'),
  intervalDays: z.number().int().min(1).optional(),
  startDate: z.string().date(),
  endDate: z.string().date().optional(),
});

app.get('/api/recurring', async c => {
  const u = c.get('userId');
  const rows = (await c.env.DB.prepare(
    `SELECT r.*,cat.name category_name,cat.icon category_icon,acc.name account_name
     FROM recurring_transactions r
     LEFT JOIN categories cat ON cat.id=r.category_id
     JOIN accounts acc ON acc.id=r.account_id
     WHERE r.user_id=? ORDER BY r.next_run_at ASC`
  ).bind(u).all()).results;
  return ok(c, rows);
});

app.post('/api/recurring', async c => {
  const b = recurringSchema.parse(await c.req.json());
  const u = c.get('userId');
  if (!await ownsAccount(c.env.DB, u, b.accountId)) return fail(c, 'FORBIDDEN', 'Account does not belong to you', 403);
  const entity = id();
  const days = b.frequency === 'weekly' ? 7 : b.frequency === 'yearly' ? 365 : b.frequency === 'custom' ? (b.intervalDays ?? 30) : 30;
  await c.env.DB.prepare(
    'INSERT INTO recurring_transactions (id,user_id,type,amount_satang,category_id,account_id,description,frequency,interval_days,start_date,end_date,next_run_at,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)'
  ).bind(entity, u, b.type, b.amountSatang, b.categoryId ?? null, b.accountId, b.description ?? null, b.frequency, days, b.startDate, b.endDate ?? null, b.startDate).run();
  await audit(c.env.DB, u, 'create', 'recurring', entity);
  return ok(c, { id: entity }, 201);
});

app.patch('/api/recurring/:id', async c => {
  const u = c.get('userId'), entity = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM recurring_transactions WHERE id=? AND user_id=?').bind(entity, u).first();
  if (!existing) return fail(c, 'NOT_FOUND', 'Recurring transaction not found', 404);
  const b = recurringSchema.extend({ active: z.boolean().optional() }).parse(await c.req.json());
  const days = b.frequency === 'weekly' ? 7 : b.frequency === 'yearly' ? 365 : b.frequency === 'custom' ? (b.intervalDays ?? 30) : 30;
  await c.env.DB.prepare(
    'UPDATE recurring_transactions SET type=?,amount_satang=?,category_id=?,account_id=?,description=?,frequency=?,interval_days=?,end_date=?,active=COALESCE(?,active),updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?'
  ).bind(b.type, b.amountSatang, b.categoryId ?? null, b.accountId, b.description ?? null, b.frequency, days, b.endDate ?? null, b.active === undefined ? null : (b.active ? 1 : 0), entity, u).run();
  await audit(c.env.DB, u, 'update', 'recurring', entity);
  return ok(c, { id: entity });
});

app.delete('/api/recurring/:id', async c => {
  const u = c.get('userId'), entity = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM recurring_transactions WHERE id=? AND user_id=?').bind(entity, u).first();
  if (!existing) return fail(c, 'NOT_FOUND', 'Recurring transaction not found', 404);
  await c.env.DB.prepare('DELETE FROM recurring_transactions WHERE id=? AND user_id=?').bind(entity, u).run();
  await audit(c.env.DB, u, 'delete', 'recurring', entity);
  return ok(c, { id: entity });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature 4: Fuel & Vehicle Mileage Tracker
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/vehicles', async c => ok(c, (await c.env.DB.prepare('SELECT * FROM vehicles WHERE user_id=? ORDER BY name').bind(c.get('userId')).all()).results));

app.post('/api/vehicles', async c => {
  const b = z.object({ name: z.string().min(1).max(100), currentValueSatang: z.number().int().nonnegative().default(0) }).parse(await c.req.json());
  const entity = id();
  await c.env.DB.prepare('INSERT INTO vehicles (id,user_id,name,current_value_satang) VALUES (?,?,?,?)').bind(entity, c.get('userId'), b.name, b.currentValueSatang).run();
  await audit(c.env.DB, c.get('userId'), 'create', 'vehicle', entity);
  return ok(c, { id: entity }, 201);
});

app.delete('/api/vehicles/:id', async c => {
  const u = c.get('userId'), entity = c.req.param('id');
  const v = await c.env.DB.prepare('SELECT id FROM vehicles WHERE id=? AND user_id=?').bind(entity, u).first();
  if (!v) return fail(c, 'NOT_FOUND', 'Vehicle not found', 404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM fuel_logs WHERE vehicle_id=? AND user_id=?').bind(entity, u),
    c.env.DB.prepare('DELETE FROM vehicles WHERE id=? AND user_id=?').bind(entity, u),
  ]);
  return ok(c, { id: entity });
});

app.get('/api/fuel-logs', async c => {
  const u = c.get('userId'), vehicleId = c.req.query('vehicleId');
  const clauses = ['f.user_id=?']; const args: any[] = [u];
  if (vehicleId) { clauses.push('f.vehicle_id=?'); args.push(vehicleId); }
  const rows = (await c.env.DB.prepare(
    `SELECT f.*,v.name vehicle_name FROM fuel_logs f JOIN vehicles v ON v.id=f.vehicle_id WHERE ${clauses.join(' AND ')} ORDER BY f.log_date DESC,f.created_at DESC LIMIT 100`
  ).bind(...args).all<any>()).results;

  // Compute fuel stats
  const totalLiters = rows.reduce((s: number, r: any) => s + (r.liters_micros / 1_000_000), 0);
  const totalSpent = rows.reduce((s: number, r: any) => s + r.total_satang, 0);

  // km/L: need at least 2 fill-ups to compute distance
  let kmPerLiter: number | null = null;
  let thbPerKm: number | null = null;
  if (rows.length >= 2) {
    const sorted = [...rows].sort((a: any, b: any) => a.odometer_km - b.odometer_km);
    const distKm = sorted[sorted.length - 1].odometer_km - sorted[0].odometer_km;
    if (distKm > 0 && totalLiters > 0) {
      kmPerLiter = Math.round((distKm / totalLiters) * 10) / 10;
      thbPerKm = Math.round((totalSpent / distKm)); // satang/km
    }
  }

  return ok(c, { logs: rows, stats: { totalLiters: Math.round(totalLiters * 100) / 100, totalSpentSatang: totalSpent, kmPerLiter, thbPerKmSatang: thbPerKm } });
});


app.post('/api/fuel-logs', async c => {
  const b = z.object({
    vehicleId: z.string().uuid(),
    logDate: z.string().date(),
    odometerKm: z.number().int().nonnegative(),
    litersMicros: z.number().int().positive(), // millionths of a liter e.g. 40.5L = 40500000
    pricePerLiterSatang: z.number().int().positive(),
    totalSatang: z.number().int().positive(),
    station: z.string().max(100).optional(),
    note: z.string().max(500).optional(),
  }).parse(await c.req.json());
  const u = c.get('userId');
  const v = await c.env.DB.prepare('SELECT id FROM vehicles WHERE id=? AND user_id=?').bind(b.vehicleId, u).first();
  if (!v) return fail(c, 'FORBIDDEN', 'Vehicle does not belong to you', 403);
  const entity = id();
  await c.env.DB.prepare(
    'INSERT INTO fuel_logs (id,user_id,vehicle_id,log_date,odometer_km,liters_micros,price_per_liter_satang,total_satang,station,note) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(entity, u, b.vehicleId, b.logDate, b.odometerKm, b.litersMicros, b.pricePerLiterSatang, b.totalSatang, b.station ?? null, b.note ?? null).run();
  await audit(c.env.DB, u, 'create', 'fuel_log', entity);
  return ok(c, { id: entity }, 201);
});

app.delete('/api/fuel-logs/:id', async c => {
  const u = c.get('userId'), entity = c.req.param('id');
  const f = await c.env.DB.prepare('SELECT id FROM fuel_logs WHERE id=? AND user_id=?').bind(entity, u).first();
  if (!f) return fail(c, 'NOT_FOUND', 'Fuel log not found', 404);
  await c.env.DB.prepare('DELETE FROM fuel_logs WHERE id=? AND user_id=?').bind(entity, u).run();
  return ok(c, { id: entity });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature 3: Export CSV
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/export/csv', async c => {
  const u = c.get('userId');
  const monthFilter = c.req.query('month');
  const clauses = ['t.user_id=?']; const args: any[] = [u];
  if (monthFilter) { clauses.push("substr(t.transaction_date,1,7)=?"); args.push(monthFilter); }
  const rows = (await c.env.DB.prepare(
    `SELECT t.transaction_date,t.type,t.amount_satang,COALESCE(c.name,'') category_name,COALESCE(a.name,'') account_name,COALESCE(t.description,'') description,COALESCE(t.payment_method,'') payment_method,COALESCE(t.tags_json,'[]') tags_json
     FROM transactions t LEFT JOIN categories c ON c.id=t.category_id JOIN accounts a ON a.id=t.account_id
     WHERE ${clauses.join(' AND ')} ORDER BY t.transaction_date DESC,t.created_at DESC`
  ).bind(...args).all<any>()).results;

  const typeLabel = (type: string) => ({ income:'รายรับ', expense:'รายจ่าย', transfer:'โอนเงิน', investment_buy:'ซื้อการลงทุน', investment_sell:'ขายการลงทุน', dividend:'เงินปันผล', interest:'ดอกเบี้ย', refund:'คืนเงิน', adjustment:'ปรับยอด' }[type] ?? type);
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;

  const headers = ['วันที่','ประเภท','จำนวนเงิน (บาท)','หมวดหมู่','บัญชี','รายละเอียด','ช่องทางชำระ','แท็ก'];
  const lines = ['\uFEFF' + headers.join(',')]; // UTF-8 BOM for Excel Thai support
  for (const r of rows) {
    let tags = '';
    try { const t = JSON.parse(r.tags_json); tags = Array.isArray(t) ? t.join('; ') : ''; } catch { tags = ''; }
    lines.push([
      escape(r.transaction_date),
      escape(typeLabel(r.type)),
      escape(String(r.amount_satang / 100)),
      escape(r.category_name),
      escape(r.account_name),
      escape(r.description),
      escape(r.payment_method),
      escape(tags),
    ].join(','));
  }

  const filename = monthFilter ? `รายการ_${monthFilter}.csv` : 'รายการทั้งหมด.csv';
  return new Response(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature 1: Telegram Bot Webhook (handle /summary /today /bills commands)
// ─────────────────────────────────────────────────────────────────────────────
async function sendTelegramMessage(token: string, chatId: string | number, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

function fmtBaht(satang: number) { return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(satang / 100); }

app.post('/api/telegram/webhook', async c => {
  const body: any = await c.req.json().catch(() => ({}));
  const message = body?.message;
  if (!message) return c.json({ ok: true });

  const chatId = message.chat?.id;
  const telegramId = String(message.from?.id ?? '');
  const text: string = (message.text ?? '').trim().toLowerCase();

  if (!chatId || !telegramId) return c.json({ ok: true });

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE telegram_id=?').bind(telegramId).first<{ id: number; first_name?: string }>();
  if (!user) {
    await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, '❌ ยังไม่ได้เชื่อมต่อกับ FinaPlan\nกรุณาเปิดแอปผ่าน Telegram Mini App ก่อนนะครับ');
    return c.json({ ok: true });
  }

  const m = now().slice(0, 7);
  const d = now().slice(0, 10);

  if (text === '/start' || text === '/help') {
    await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, chatId,
      `🏦 <b>FinaPlan Bot</b>\n\nสวัสดีครับ ${user.first_name ?? 'คุณ'}! 👋\n\nคำสั่งที่ใช้ได้:\n/summary หรือ /today — สรุปยอดวันนี้\n/month — สรุปยอดเดือนนี้\n/bills — รายการประจำที่กำลังจะถึง\n/help — ดูรายการคำสั่ง`
    );
  } else if (text === '/summary' || text === '/today') {
    const todaySummary = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN type IN ('income','refund','interest','dividend') THEN amount_satang ELSE 0 END),0) income,
       COALESCE(SUM(CASE WHEN type='expense' THEN amount_satang ELSE 0 END),0) expense,
       COUNT(*) cnt FROM transactions WHERE user_id=? AND transaction_date=?`
    ).bind(user.id, d).first<{ income: number; expense: number; cnt: number }>();
    const net = (todaySummary?.income ?? 0) - (todaySummary?.expense ?? 0);
    const sign = net >= 0 ? '+' : '';
    await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, chatId,
      `📊 <b>สรุปยอดวันนี้ (${d})</b>\n\n` +
      `💚 รายรับ: ${fmtBaht(todaySummary?.income ?? 0)}\n` +
      `❤️ รายจ่าย: ${fmtBaht(todaySummary?.expense ?? 0)}\n` +
      `📌 ยอดสุทธิ: ${sign}${fmtBaht(net)}\n` +
      `🔢 รายการทั้งหมด: ${todaySummary?.cnt ?? 0} รายการ`
    );
  } else if (text === '/month') {
    const monthSummary = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN type IN ('income','refund','interest','dividend') THEN amount_satang ELSE 0 END),0) income,
       COALESCE(SUM(CASE WHEN type='expense' THEN amount_satang ELSE 0 END),0) expense,
       COUNT(*) cnt FROM transactions WHERE user_id=? AND substr(transaction_date,1,7)=?`
    ).bind(user.id, m).first<{ income: number; expense: number; cnt: number }>();
    const net = (monthSummary?.income ?? 0) - (monthSummary?.expense ?? 0);
    const topCat = await c.env.DB.prepare(
      `SELECT c.name,SUM(t.amount_satang) total FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
       WHERE t.user_id=? AND t.type='expense' AND substr(t.transaction_date,1,7)=? GROUP BY c.name ORDER BY total DESC LIMIT 3`
    ).bind(user.id, m).all<{ name: string; total: number }>();
    let catText = '';
    topCat.results.forEach((r, i) => { catText += `\n  ${i + 1}. ${r.name ?? 'อื่นๆ'}: ${fmtBaht(r.total)}`; });
    await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, chatId,
      `📅 <b>สรุปเดือนนี้ (${m})</b>\n\n` +
      `💚 รายรับ: ${fmtBaht(monthSummary?.income ?? 0)}\n` +
      `❤️ รายจ่าย: ${fmtBaht(monthSummary?.expense ?? 0)}\n` +
      `💰 ยอดสุทธิ: ${fmtBaht(net)}\n` +
      `🔢 รายการ: ${monthSummary?.cnt ?? 0} รายการ\n\n` +
      `🏆 <b>หมวดหมู่ที่ใช้มากสุด:</b>${catText || '\n  ยังไม่มีข้อมูล'}`
    );
  } else if (text === '/bills') {
    const upcoming = (await c.env.DB.prepare(
      `SELECT r.*,cat.name category_name FROM recurring_transactions r
       LEFT JOIN categories cat ON cat.id=r.category_id
       WHERE r.user_id=? AND r.active=1 AND r.next_run_at<=date('now','+7 days') ORDER BY r.next_run_at ASC LIMIT 10`
    ).bind(user.id).all<any>()).results;
    if (!upcoming.length) {
      await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, '✅ ไม่มีรายการประจำที่กำลังจะถึงกำหนดในอีก 7 วันข้างหน้า');
    } else {
      let msg = `🔔 <b>รายการประจำที่กำลังจะถึง (7 วัน)</b>\n`;
      upcoming.forEach(r => {
        msg += `\n📌 ${r.description ?? r.category_name ?? 'ไม่ระบุ'}\n   กำหนด: ${r.next_run_at} | ${fmtBaht(r.amount_satang)}\n`;
      });
      await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, msg);
    }
  } else {
    await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, chatId,
      `❓ ไม่รู้จักคำสั่งนี้ครับ\nพิมพ์ /help เพื่อดูคำสั่งที่ใช้ได้`
    );
  }

  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled Cron Handler
// ─────────────────────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,
  async scheduled(_: ScheduledEvent, env: Env) {
    // 1. Process recurring transactions
    const due = await env.DB.prepare("SELECT * FROM recurring_transactions WHERE active=1 AND next_run_at<=date('now')").all<any>();
    for (const r of due.results) {
      const key = `recurring:${r.id}:${r.next_run_at}`;
      const existing = await env.DB.prepare('SELECT id FROM transactions WHERE user_id=? AND idempotency_key=?').bind(r.user_id, key).first();
      if (!existing) {
        await env.DB.batch([
          env.DB.prepare('INSERT INTO transactions (id,user_id,type,amount_satang,category_id,account_id,description,transaction_date,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?)').bind(id(), r.user_id, r.type, r.amount_satang, r.category_id, r.account_id, r.description, r.next_run_at, key),
          env.DB.prepare("UPDATE accounts SET balance_satang=balance_satang + CASE WHEN ?='income' THEN ? ELSE -? END WHERE id=?").bind(r.type, r.amount_satang, r.amount_satang, r.account_id),
        ]);
      }
      const days = r.frequency === 'weekly' ? 7 : r.frequency === 'yearly' ? 365 : r.frequency === 'custom' ? r.interval_days : 30;
      await env.DB.prepare("UPDATE recurring_transactions SET next_run_at=date(next_run_at, '+' || ? || ' days') WHERE id=?").bind(days, r.id).run();
    }

    // 2. Daily summary + bill alerts (runs at cron time ~20:00 Bangkok)
    const currentHour = new Date().getUTCHours(); // 13 UTC = 20:00 Bangkok
    if (currentHour === 13) {
      const users = (await env.DB.prepare('SELECT id,telegram_id,first_name FROM users WHERE telegram_id IS NOT NULL').all<{ id: number; telegram_id: string; first_name?: string }>()).results;
      const todayDate = new Date().toISOString().slice(0, 10);
      const currentMonth = todayDate.slice(0, 7);

      for (const user of users) {
        try {
          // Daily summary
          const summary = await env.DB.prepare(
            `SELECT COALESCE(SUM(CASE WHEN type IN ('income','refund','interest','dividend') THEN amount_satang ELSE 0 END),0) income,
             COALESCE(SUM(CASE WHEN type='expense' THEN amount_satang ELSE 0 END),0) expense,
             COUNT(*) cnt FROM transactions WHERE user_id=? AND transaction_date=?`
          ).bind(user.id, todayDate).first<{ income: number; expense: number; cnt: number }>();

          const monthSummary = await env.DB.prepare(
            `SELECT COALESCE(SUM(CASE WHEN type IN ('income','refund','interest','dividend') THEN amount_satang ELSE 0 END),0) income,
             COALESCE(SUM(CASE WHEN type='expense' THEN amount_satang ELSE 0 END),0) expense
             FROM transactions WHERE user_id=? AND substr(transaction_date,1,7)=?`
          ).bind(user.id, currentMonth).first<{ income: number; expense: number }>();

          // Upcoming bills in next 3 days
          const upcoming = (await env.DB.prepare(
            `SELECT r.description,r.amount_satang,r.next_run_at,cat.name category_name
             FROM recurring_transactions r LEFT JOIN categories cat ON cat.id=r.category_id
             WHERE r.user_id=? AND r.active=1 AND r.next_run_at<=date('now','+3 days') ORDER BY r.next_run_at ASC LIMIT 5`
          ).bind(user.id).all<any>()).results;

          const net = (summary?.income ?? 0) - (summary?.expense ?? 0);
          const monthNet = (monthSummary?.income ?? 0) - (monthSummary?.expense ?? 0);
          const netSign = net >= 0 ? '+' : '';
          const monthSign = monthNet >= 0 ? '+' : '';

          let msg = `🌙 <b>สรุปยอดประจำวัน — ${todayDate}</b>\n\n`;
          msg += `📋 รายการวันนี้: ${summary?.cnt ?? 0} รายการ\n`;
          msg += `💚 รายรับ: ${fmtBaht(summary?.income ?? 0)}\n`;
          msg += `❤️ รายจ่าย: ${fmtBaht(summary?.expense ?? 0)}\n`;
          msg += `📌 สุทธิ: ${netSign}${fmtBaht(net)}\n\n`;
          msg += `📅 <b>ยอดสะสมเดือนนี้:</b>\n`;
          msg += `   รายรับ ${fmtBaht(monthSummary?.income ?? 0)} / รายจ่าย ${fmtBaht(monthSummary?.expense ?? 0)}\n`;
          msg += `   ยอดสุทธิ: ${monthSign}${fmtBaht(monthNet)}\n`;

          if (upcoming.length > 0) {
            msg += `\n🔔 <b>บิลที่กำลังจะถึงใน 3 วัน:</b>\n`;
            upcoming.forEach(r => {
              msg += `  • ${r.description ?? r.category_name ?? 'รายการประจำ'} — ${fmtBaht(r.amount_satang)} (${r.next_run_at})\n`;
            });
          }

          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, user.telegram_id, msg);
        } catch (e) {
          console.error(`Failed to send daily summary to user ${user.id}:`, e);
        }
      }
    }
  },
};
