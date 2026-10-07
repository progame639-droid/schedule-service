(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const categories = {
    food: { label: 'Продукты', color: '#d4f78b' },
    transport: { label: 'Транспорт', color: '#92b9ff' },
    entertainment: { label: 'Развлечения', color: '#b49aff' },
    bills: { label: 'Коммуналка', color: '#ffa98e' },
    shopping: { label: 'Покупки', color: '#ff9ac7' },
    health: { label: 'Здоровье', color: '#85ded1' },
    salary: { label: 'Зарплата', color: '#d4f78b' },
    freelance: { label: 'Фриланс', color: '#b49aff' },
    other: { label: 'Другое', color: '#b8bfce' }
  };
  const demoKey = 'potok-demo-v1';
  const currency = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  const configured = ['http:', 'https:'].includes(location.protocol) && new URL(location.href).searchParams.get('demo') !== '1';
  let transactions = [], user = null, channel = null, expiryTimer = null;
  let mode = configured ? 'signed-out' : 'demo';
  let pendingDelete = null, toastTimer, requestVersion = 0, memoryOnly = false, loading = false;

  const money = (cents) => currency.formatToParts(cents / 100).map(part => part.type === 'currency' ? '₸' : part.value).join('');
  const cents = (amount) => Math.round(Number(amount) * 100);
  const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const plural = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'операция' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'операции' : 'операций'}`;

  function toast(message, error = false) {
    $('toast').textContent = message;
    $('toast').classList.toggle('toast--error', error);
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
  }
  function svgIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(svg.namespaceURI, 'use');
    use.setAttribute('href', `#icon-${name}`); svg.append(use); return svg;
  }
  function element(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function isValidTransaction(t) {
    return t && typeof t.id === 'string' && typeof t.title === 'string' && t.title.length <= 100 &&
      Number.isFinite(Number(t.amount)) && Number(t.amount) > 0 && Number(t.amount) <= 999999999 &&
      ['income', 'expense'].includes(t.type) && Object.hasOwn(categories, t.category) &&
      Number.isFinite(new Date(t.created_at).getTime());
  }
  function seed() {
    const now = new Date();
    const sample = [];
    for (let offset = 5; offset >= 0; offset--) {
      const stamp = (day) => new Date(now.getFullYear(), now.getMonth() - offset, offset ? day : Math.min(day, now.getDate()), 12).toISOString();
      const records = [
        ['Зарплата', 320000 + (5 - offset) * 18000, 'income', 'salary', 1],
        ['Проект для клиента', 45000 + (5 - offset) * 6000, 'income', 'freelance', 3],
        ['Продукты на неделю', 22500 + offset * 850, 'expense', 'food', 4],
        ['Квартира и коммуналка', 85000, 'expense', 'bills', 5],
        ['Поездки по городу', 6500 + offset * 200, 'expense', 'transport', 6],
        ['Подписка и кино', 8900, 'expense', 'entertainment', 7]
      ];
      if (!offset) records.push(['Новые кроссовки', 34500, 'expense', 'shopping', 7], ['Абонемент в зал', 18500, 'expense', 'health', 6]);
      records.forEach(([title, amount, type, category, day]) => sample.push({ id: id(), title, amount, type, category, created_at: stamp(day) }));
    }
    return sample;
  }
  function readDemo() {
    try {
      const stored = localStorage.getItem(demoKey);
      if (stored === null) { const data = seed(); localStorage.setItem(demoKey, JSON.stringify(data)); return data; }
      const data = JSON.parse(stored);
      if (!Array.isArray(data) || !data.every(isValidTransaction)) throw new Error('invalid');
      return data;
    } catch {
      memoryOnly = true;
      toast('Локальное хранилище недоступно или повреждено. Демо работает до закрытия страницы.', true);
      return seed();
    }
  }
  function storeDemo(next) {
    if (!memoryOnly) {
      try { localStorage.setItem(demoKey, JSON.stringify(next)); }
      catch { throw new Error('Не удалось сохранить данные в браузере. Проверьте свободное место и настройки хранения.'); }
    }
    transactions = next;
  }
  function periodTransactions() {
    const selection = $('period').value;
    if (selection === 'all') return transactions;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (selection === 'last-month' ? 1 : 0), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return transactions.filter(t => { const date = new Date(t.created_at); return date >= start && date < end; });
  }
  function renderProfile() {
    const remote = mode === 'remote';
    $('mode-label').textContent = remote ? 'Облако' : mode === 'demo' ? 'Деморежим' : user ? 'Второй фактор' : 'Без входа';
    $('profile-name').textContent = user?.user_metadata?.full_name || user?.email || 'Гость';
    $('auth-button').textContent = remote ? 'Выйти' : user ? 'Подтвердить вход' : 'Войти';
    $('add-button').disabled = loading || mode === 'signed-out';
    $('context-label').textContent = remote ? 'Ваши операции · синхронизация с Supabase' : mode === 'demo' ? `Демонстрационные данные · ${memoryOnly ? 'до закрытия страницы' : 'хранятся в этом браузере'}` : user ? 'Подтвердите второй фактор, чтобы открыть финансы' : 'Войдите в аккаунт, чтобы начать учёт финансов';
    $('storage-label').textContent = remote ? 'Облако · личный аккаунт' : mode === 'demo' ? `Демо · ${memoryOnly ? 'временные данные' : 'данные только на этом устройстве'}` : 'Вход не выполнен';
    $('form-storage').textContent = remote ? 'Операция сохранится в вашем аккаунте Supabase.' : memoryOnly ? 'Демооперация сохранится до закрытия страницы.' : 'Демооперация сохранится в этом браузере.';
  }
  function render() {
    renderProfile();
    const period = periodTransactions();
    const total = type => period.filter(t => t.type === type).reduce((sum, t) => sum + cents(t.amount), 0);
    const income = total('income'), expense = total('expense');
    $('balance').textContent = money(income - expense); $('income').textContent = money(income); $('expense').textContent = money(expense);
    $('income-count').textContent = plural(period.filter(t => t.type === 'income').length);
    $('expense-count').textContent = plural(period.filter(t => t.type === 'expense').length);
    renderCategories(period, expense); renderTrend(); renderTransactions(period);
  }
  function renderCategories(period, expense) {
    const sums = {};
    period.filter(t => t.type === 'expense').forEach(t => { sums[t.category] = (sums[t.category] || 0) + cents(t.amount); });
    const entries = Object.entries(sums).sort((a,b) => b[1] - a[1]);
    let offset = 0;
    const stops = entries.map(([key,value]) => { const start = offset; offset += value / expense * 100; return `${categories[key].color} ${start}% ${offset}%`; });
    $('category-ring').style.background = stops.length ? `conic-gradient(${stops.join(',')})` : '#2c2f38';
    $('category-count').textContent = entries.length;
    $('category-ring').setAttribute('aria-label', entries.length ? entries.map(([key,value]) => `${categories[key].label}: ${money(value)}`).join('; ') : 'Нет расходов');
    $('category-legend').replaceChildren();
    if (!entries.length) { $('category-legend').append(element('p','category-chart__empty','Появится после первого расхода')); return; }
    entries.forEach(([key,value]) => {
      const row = element('div','category-chart__item');
      row.append(element('span',`category-chart__swatch category-color--${key}`),element('span','category-chart__name',categories[key].label),element('span','category-chart__percent',`${Math.round(value / expense * 100)}%`));
      row.title = `${categories[key].label}: ${money(value)}`; $('category-legend').append(row);
    });
  }
  function renderTrend() {
    const now = new Date();
    const months = Array.from({length:6},(_,i) => new Date(now.getFullYear(), now.getMonth() - 5 + i,1));
    const values = months.map(month => {
      const entries = transactions.filter(t => { const d = new Date(t.created_at); return d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear(); });
      return {income:entries.filter(t=>t.type==='income').reduce((s,t)=>s+cents(t.amount),0),expense:entries.filter(t=>t.type==='expense').reduce((s,t)=>s+cents(t.amount),0)};
    });
    const max = Math.max(...values.flatMap(x=>[x.income,x.expense]),10000) * 1.15;
    const x = i => 48+i*88, y = val => 165 - val/max*140;
    const points = type => values.map((value,i)=>`${x(i)},${y(value[type]).toFixed(2)}`).join(' ');
    const ticks = [0, .5, 1].map(r=>`<line class="chart__grid" x1="48" x2="488" y1="${y(r*max)}" y2="${y(r*max)}"/><text class="chart__label" x="0" y="${y(r*max)+4}">${Math.round(r*max/100000)}k</text>`).join('');
    const labels = months.map((month,i)=>`<text class="chart__label" x="${x(i)}" y="194" text-anchor="middle">${new Intl.DateTimeFormat('ru-RU',{month:'short'}).format(month).replace('.','')}</text>`).join('');
    const descriptions = values.map((v,i)=>`${months[i].toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}: доходы ${money(v.income)}, расходы ${money(v.expense)}`).join('; ');
    // Only computed numbers and trusted month labels are inserted into SVG markup.
    $('trend-chart').innerHTML = `<svg class="chart__svg" viewBox="0 0 520 210" role="img" aria-label="График доходов и расходов"><title></title><defs><linearGradient id="income-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d4f78b" stop-opacity=".16"/><stop offset="100%" stop-color="#d4f78b" stop-opacity="0"/></linearGradient></defs>${ticks}<polygon class="chart__area" points="48,165 ${points('income')} 488,165"/><polyline class="chart__line chart__line--income" points="${points('income')}"/><polyline class="chart__line chart__line--expense" points="${points('expense')}"/>${values.map((v,i)=>`<circle class="chart__point" cx="${x(i)}" cy="${y(v.income)}" r="3"/>`).join('')}${labels}</svg>`;
    $('trend-chart').querySelector('title').textContent = descriptions;
  }
  function renderTransactions(period) {
    const query = $('search').value.trim().toLocaleLowerCase('ru');
    const type = $('type-filter').value;
    const filtered = period.filter(t => (type === 'all' || t.type === type) && `${t.title} ${categories[t.category].label}`.toLocaleLowerCase('ru').includes(query)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)||b.id.localeCompare(a.id));
    const list = $('transaction-list'); list.replaceChildren();
    $('transaction-count').textContent = filtered.length;
    $('empty-state').hidden = filtered.length > 0 || loading;
    const emptyTitle = $('empty-state').querySelector('.empty__title'), emptyText = $('empty-state').querySelector('.empty__text');
    emptyTitle.textContent = mode === 'signed-out' ? 'Ваши финансы начинаются здесь' : query || type !== 'all' ? 'Ничего не найдено' : 'Пока нет операций';
    emptyText.textContent = mode === 'signed-out' ? 'Войдите в аккаунт, чтобы добавить первую операцию.' : query || type !== 'all' ? 'Попробуйте другой запрос или тип операции.' : 'Добавьте первую операцию, чтобы увидеть баланс.';
    filtered.forEach(t => {
      const row = element('li','transaction-item');
      const main = element('div','transaction-item__main'); const icon = element('span',`transaction-item__icon category--${t.category}`); icon.append(svgIcon(t.category));
      const text = element('div','transaction-item__description'); text.append(element('h3','transaction-item__title',t.title),element('span','transaction-item__type',t.type==='income'?'Доход':'Расход'));main.append(icon,text);
      const category = element('div','transaction-item__category'); category.append(element('span',`badge category--${t.category}`,categories[t.category].label));
      const date = element('time','transaction-item__date',dateFormat.format(new Date(t.created_at)));date.dateTime=t.created_at;
      const amount = element('span',`transaction-item__amount transaction-item__amount--${t.type}`,`${t.type==='income'?'+':'−'}${money(cents(t.amount))}`);
      const button = element('button','icon-button transaction-item__delete'); button.type='button';button.setAttribute('aria-label',`Удалить ${t.title}`);button.append(svgIcon('trash'));
      button.addEventListener('click',()=>{ pendingDelete=t.id;$('delete-description').textContent=`«${t.title}» · ${money(cents(t.amount))}. Это действие нельзя отменить.`;$('delete-modal').showModal(); });
      row.append(main,category,date,amount,button);list.append(row);
    });
    $('list-footer').textContent = loading ? 'Загрузка операций…' : `Показано ${plural(filtered.length)} из ${period.length} за выбранный период`;
  }
  function updateFormCategories() {
    const income = $('transaction-form').elements.type.value === 'income';
    const allowed = income ? ['salary','freelance','other'] : ['food','transport','entertainment','bills','shopping','health','other'];
    $('category').replaceChildren(...allowed.map(key => { const option=document.createElement('option');option.value=key;option.textContent=categories[key].label;return option; }));
  }
  async function loadRemote() {
    if (!user || mode !== 'remote') return;
    const currentUser=user.id,version=++requestVersion;
    try {
      const data=await window.PotokAuth.request('transactions');
      if(currentUser!==user?.id||version!==requestVersion||mode!=='remote')return;
      transactions=(data.transactions||[]).filter(isValidTransaction);loading=false;render();
    }catch(error){loading=false;render();toast(error.message,true);}
  }
  async function handleAuth(auth) {
    clearTimeout(expiryTimer);
    if(auth.user&&Number.isFinite(auth.expiresAt))expiryTimer=setTimeout(()=>window.PotokAuth.init(),Math.max(0,auth.expiresAt-Date.now()+100));
    const canRead=auth.user&&!auth.mfaRequired&&!auth.recovery;
    if(channel){channel.close();channel=null;}
    requestVersion++;transactions=[];user=auth.user||null;mode=canRead?'remote':'signed-out';loading=Boolean(canRead);render();
    ['transaction-modal','delete-modal'].forEach(name=>{if($(name).open)$(name).close();});pendingDelete=null;
    if(!canRead)return;
    await loadRemote();
    if(mode==='remote') {
      channel=new EventSource('/api/events');
      channel.addEventListener('update',()=>loadRemote());
      channel.addEventListener('expired',()=>{channel.close();channel=null;window.PotokAuth.init();});
    }
  }
  window.addEventListener('potok-auth',event=>{if(configured)handleAuth(event.detail);});

  $('today').textContent=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(new Date());
  ['period','type-filter'].forEach(name=>$(name).addEventListener('change',render));
  $('search').addEventListener('input',()=>renderTransactions(periodTransactions()));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('transaction-form').addEventListener('change',event=>{if(event.target.name==='type')updateFormCategories();});
  $('add-button').addEventListener('click',()=>{
    if(mode==='signed-out')return;
    $('transaction-form').reset();updateFormCategories();$('date').value=localDate();$('date').max=localDate();$('date').min='2000-01-01';$('form-error').hidden=true;$('transaction-modal').showModal();$('title').focus();
  });
  $('transaction-form').addEventListener('submit',async event=>{
    event.preventDefault(); const form=$('transaction-form'); if(!form.reportValidity())return;
    const title=form.elements.title.value.trim();const raw=form.elements.amount.value.trim().replace(',','.');const amount=Number(raw);
    const enteredDate=new Date(`${form.elements.date.value}T12:00:00`);
    if(!title||!/^\d+(\.\d{1,2})?$/.test(raw)||!Number.isFinite(amount)||amount<=0||amount>999999999||!Number.isFinite(enteredDate.getTime())||form.elements.date.value>localDate()||form.elements.date.value<'2000-01-01') {
      $('form-error').textContent='Укажите название, сумму от 0,01 до 999 999 999 ₸ и корректную дату без будущего времени.';$('form-error').hidden=false;return;
    }
    const record={title,amount:cents(amount)/100,type:form.elements.type.value,category:form.elements.category.value,created_at:enteredDate.toISOString()};
    $('save-button').disabled=true;$('form-error').hidden=true;
    try {
      if(mode==='demo') {storeDemo([{...record,id:id()},...transactions]);render();}
      else if(user&&mode==='remote') {
        const owner=user.id;
        const result=await window.PotokAuth.request('transactions',record);const data=result.transaction;
        if(owner!==user?.id)throw new Error('Аккаунт изменился. Обновите страницу.');
        // Render the saved record immediately; a following refresh resolves concurrent changes.
        transactions=[data,...transactions.filter(t=>t.id!==data.id)];render();await loadRemote();
      } else throw new Error('Сначала войдите в аккаунт.');
      $('transaction-modal').close();toast('Операция добавлена');
    }catch(error){$('form-error').textContent=error.message;$('form-error').hidden=false;}
    finally{$('save-button').disabled=false;}
  });
  $('confirm-delete').addEventListener('click',async()=>{
    const target=pendingDelete;if(!target)return;$('confirm-delete').disabled=true;
    try {
      if(mode==='demo')storeDemo(transactions.filter(t=>t.id!==target));
      else if(user&&mode==='remote') {
        await window.PotokAuth.request('transactions',{id:target},'DELETE');
        transactions=transactions.filter(t=>t.id!==target);
      } else throw new Error('Войдите в аккаунт.');
      render();$('delete-modal').close();pendingDelete=null;toast('Операция удалена');
      if(mode==='remote')await loadRemote();
    }catch(error){toast(error.message,true);}
    finally{$('confirm-delete').disabled=false;}
  });
  $('auth-button').addEventListener('click',async()=>{
    $('auth-button').disabled=true;
    try {
      if(user&&mode==='remote'){await window.PotokAuth.logout();toast('Вы вышли на всех устройствах');}
      else if(user)await window.PotokAuth.init();
      else window.PotokAuth.open();
    }catch(error){toast(error.message,true);}
    finally{$('auth-button').disabled=false;}
  });
  document.addEventListener('visibilitychange',()=>{if(configured&&!document.hidden)window.PotokAuth.init();});
  window.addEventListener('storage',event=>{if(event.key===demoKey && mode==='demo'){transactions=readDemo();render();}});
  if(mode==='demo')transactions=readDemo();
  render();
  if(configured)window.PotokAuth.init();
})();
