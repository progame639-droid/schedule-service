require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { createClient } = require("@supabase/supabase-js");

const bot = new Telegraf(process.env.BOT_TOKEN);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const selectedGroups = new Map();

function todayNumber() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

function dayName(day) {
  return ["", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"][day] || "Неизвестный день";
}

async function getGroups() {
  const { data, error } = await db.from("groups").select("id,name").order("name");
  if (error) throw error;
  return data || [];
}

async function getSchedule(groupId) {
  const { data, error } = await db
    .from("schedule")
    .select("lesson_number,subject_name,time_start,time_end")
    .eq("group_id", groupId)
    .eq("day_of_week", todayNumber())
    .order("lesson_number");
  if (error) throw error;
  return data || [];
}

async function chooseGroup(ctx) {
  const groups = await getGroups();
  const buttons = groups.map(g => [Markup.button.callback(g.name, `group:${g.id}`)]);
  await ctx.reply("Выберите группу:", Markup.inlineKeyboard(buttons));
}

bot.start(async ctx => {
  try {
    await ctx.reply("Привет! Это бот расписания.");
    await chooseGroup(ctx);
  } catch (e) {
    await ctx.reply("Ошибка: " + e.message);
  }
});

bot.command("group", async ctx => {
  try { await chooseGroup(ctx); } catch (e) { await ctx.reply("Ошибка: " + e.message); }
});

bot.action(/^group:(\d+)$/, async ctx => {
  const groupId = Number(ctx.match[1]);
  selectedGroups.set(ctx.from.id, groupId);
  await ctx.answerCbQuery("Группа выбрана");
  await ctx.reply("Группа сохранена. Доступны /today и /now.");
});

bot.command("today", async ctx => {
  try {
    const groupId = selectedGroups.get(ctx.from.id);
    if (!groupId) return ctx.reply("Сначала выберите группу: /group");

    const lessons = await getSchedule(groupId);
    if (!lessons.length) return ctx.reply(`На ${dayName(todayNumber())} пар нет.`);

    let text = `Расписание на сегодня — ${dayName(todayNumber())}:\n\n`;
    lessons.forEach(l => {
      text += `${l.lesson_number} пара — ${l.subject_name}\n${l.time_start.slice(0,5)} - ${l.time_end.slice(0,5)}\n\n`;
    });
    await ctx.reply(text);
  } catch (e) { await ctx.reply("Ошибка: " + e.message); }
});

bot.command("now", async ctx => {
  try {
    const groupId = selectedGroups.get(ctx.from.id);
    if (!groupId) return ctx.reply("Сначала выберите группу: /group");

    const lessons = await getSchedule(groupId);
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();

    for (const l of lessons) {
      const [sh, sm] = l.time_start.slice(0,5).split(":").map(Number);
      const [eh, em] = l.time_end.slice(0,5).split(":").map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;

      if (minutes >= start && minutes < end) {
        return ctx.reply(`Сейчас идет ${l.lesson_number} пара: ${l.subject_name} (${l.time_start.slice(0,5)} - ${l.time_end.slice(0,5)}).`);
      }
      if (minutes < start) {
        return ctx.reply(`Сейчас перемена. Следующая пара в ${l.time_start.slice(0,5)}: ${l.subject_name}.`);
      }
    }

    await ctx.reply("На сегодня все пары закончились.");
  } catch (e) { await ctx.reply("Ошибка: " + e.message); }
});

bot.launch();
console.log("Telegram bot started.");
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
