const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Vercel: Telegram sends updates to this serverless function.
const handler = bot.webhookCallback('/api/bot');

function todayNumber() {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

function dayName(day) {
  return ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][day] || 'Неизвестный день';
}

async function getGroups() {
  const { data, error } = await db.from('groups').select('id,name').order('name');
  if (error) throw error;
  return data || [];
}

async function getSchedule(groupId) {
  const { data, error } = await db
    .from('schedule')
    .select('lesson_number,subject_name,time_start,time_end')
    .eq('group_id', groupId)
    .eq('day_of_week', todayNumber())
    .order('lesson_number');
  if (error) throw error;
  return data || [];
}

async function chooseGroup(ctx) {
  const groups = await getGroups();
  if (!groups.length) return ctx.reply('В базе пока нет групп.');
  return ctx.reply(
    'Выберите группу:',
    Markup.inlineKeyboard(groups.map(g => [Markup.button.callback(g.name, `group:${g.id}`)]))
  );
}

bot.start(async ctx => {
  await ctx.reply('Привет! Это бот расписания.');
  await chooseGroup(ctx);
});

bot.command('group', chooseGroup);

// Для простоты ЛР выбор хранится в памяти процесса.
// После холодного старта Vercel пользователь при необходимости снова выбирает /group.
const userGroups = new Map();

bot.action(/^group:(\d+)$/, async ctx => {
  userGroups.set(ctx.from.id, Number(ctx.match[1]));
  await ctx.answerCbQuery('Группа выбрана');
  await ctx.reply('Группа сохранена. Теперь доступны /today и /now.');
});

bot.command('today', async ctx => {
  const groupId = userGroups.get(ctx.from.id);
  if (!groupId) return ctx.reply('Сначала выберите группу: /group');

  const lessons = await getSchedule(groupId);
  if (!lessons.length) return ctx.reply(`На ${dayName(todayNumber())} пар нет.`);

  let text = `Расписание на сегодня — ${dayName(todayNumber())}:\n\n`;
  for (const l of lessons) {
    text += `${l.lesson_number} пара — ${l.subject_name}\n`;
    text += `${l.time_start.slice(0, 5)} - ${l.time_end.slice(0, 5)}\n\n`;
  }
  await ctx.reply(text);
});

bot.command('now', async ctx => {
  const groupId = userGroups.get(ctx.from.id);
  if (!groupId) return ctx.reply('Сначала выберите группу: /group');

  const lessons = await getSchedule(groupId);
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (const l of lessons) {
    const [sh, sm] = l.time_start.slice(0, 5).split(':').map(Number);
    const [eh, em] = l.time_end.slice(0, 5).split(':').map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;

    if (minutes >= start && minutes < end) {
      return ctx.reply(`Сейчас идет ${l.lesson_number} пара: ${l.subject_name}\n${l.time_start.slice(0, 5)} - ${l.time_end.slice(0, 5)}`);
    }
    if (minutes < start) {
      return ctx.reply(`Сейчас перемена.\nСледующая пара в ${l.time_start.slice(0, 5)}: ${l.subject_name}.`);
    }
  }

  await ctx.reply('На сегодня все пары закончились.');
});

bot.catch(async (err, ctx) => {
  console.error(err);
  try { await ctx.reply('Произошла ошибка. Попробуйте ещё раз.'); } catch (_) {}
});

module.exports = handler;
