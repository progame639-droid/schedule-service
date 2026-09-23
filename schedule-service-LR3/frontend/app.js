const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const groupSelect = document.getElementById("groupSelect");
const chat = document.getElementById("chat");
const statusEl = document.getElementById("status");

function addMessage(text, type = "bot") {
  const div = document.createElement("div");
  div.className = `message ${type}`;
  div.textContent = text;
  chat.appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function dayName(day) {
  return ["", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"][day] || "Неизвестный день";
}

function todayNumber() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

async function loadGroups() {
  const { data, error } = await client.from("groups").select("id,name").order("name");
  if (error) throw error;

  groupSelect.innerHTML = "";
  data.forEach(group => {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.name;
    groupSelect.appendChild(option);
  });
  statusEl.textContent = `Групп загружено: ${data.length}`;
}

async function getSchedule() {
  const groupId = groupSelect.value;
  const day = todayNumber();

  const { data, error } = await client
    .from("schedule")
    .select("lesson_number,subject_name,time_start,time_end")
    .eq("group_id", groupId)
    .eq("day_of_week", day)
    .order("lesson_number");

  if (error) throw error;
  return data || [];
}

async function showToday() {
  addMessage("/today", "user");
  try {
    const lessons = await getSchedule();
    if (!lessons.length) {
      addMessage(`На ${dayName(todayNumber())} пар нет.`);
      return;
    }

    let text = `Расписание на сегодня — ${dayName(todayNumber())}:\n\n`;
    lessons.forEach(l => {
      text += `${l.lesson_number} пара — ${l.subject_name}\n${l.time_start.slice(0,5)} - ${l.time_end.slice(0,5)}\n\n`;
    });
    addMessage(text);
  } catch (e) {
    addMessage("Ошибка загрузки расписания: " + e.message);
  }
}

async function showNow() {
  addMessage("/now", "user");
  try {
    const lessons = await getSchedule();
    if (!lessons.length) {
      addMessage("На сегодня все пары закончились или расписания нет.");
      return;
    }

    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();

    for (let i = 0; i < lessons.length; i++) {
      const l = lessons[i];
      const [sh, sm] = l.time_start.slice(0,5).split(":").map(Number);
      const [eh, em] = l.time_end.slice(0,5).split(":").map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;

      if (minutes >= start && minutes < end) {
        addMessage(`Сейчас идет ${l.lesson_number} пара: ${l.subject_name} (${l.time_start.slice(0,5)} - ${l.time_end.slice(0,5)}).`);
        return;
      }

      if (minutes < start) {
        addMessage(`Сейчас перемена. Следующая пара в ${l.time_start.slice(0,5)}: ${l.subject_name}.`);
        return;
      }
    }

    addMessage("На сегодня все пары закончились.");
  } catch (e) {
    addMessage("Ошибка: " + e.message);
  }
}

document.getElementById("todayBtn").addEventListener("click", showToday);
document.getElementById("nowBtn").addEventListener("click", showNow);

loadGroups().catch(e => {
  statusEl.textContent = "Ошибка подключения";
  addMessage("Не удалось подключиться к Supabase. Проверьте config.js.");
});
