import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@logseq/libs";
import "./style.css";

type Status = "todo" | "doing" | "done";
type Priority = "low" | "medium" | "high";
type Task = {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  dueDate: string;
  project: string;
  details: string;
  createdAt: string;
  updatedAt: string;
};

const PAGE = "Work Tasks";
const MARKER = "work-tracker-data::";

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class TaskStore {
  private dataBlockUuid: string | null = null;

  async load(): Promise<Task[]> {
    const page = await logseq.Editor.getPage(PAGE);
    if (!page) await logseq.Editor.createPage(PAGE, {}, { redirect: false });
    const blocks = await logseq.Editor.getPageBlocksTree(PAGE);
    const dataBlock = (blocks || []).find((b: any) =>
      String(b.content || b.title || "").startsWith(MARKER)
    );
    if (!dataBlock) {
      const created = await logseq.Editor.insertBlock(
        PAGE,
        `${MARKER} []`,
        { isPageBlock: true }
      );
      this.dataBlockUuid = created?.uuid || null;
      return [];
    }
    this.dataBlockUuid = dataBlock.uuid;
    const content = String(dataBlock.content || dataBlock.title || "");
    const raw = content.slice(MARKER.length).trim();
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      console.warn("[Work Tracker] Не удалось прочитать данные задач из страницы", PAGE);
      return [];
    }
  }

  async save(tasks: Task[]) {
    const content = `${MARKER} ${JSON.stringify(tasks)}`;
    if (this.dataBlockUuid) {
      await logseq.Editor.updateBlock(this.dataBlockUuid, content);
      return;
    }
    const blocks = await logseq.Editor.getPageBlocksTree(PAGE);
    const existing = (blocks || []).find((b: any) =>
      String(b.content || b.title || "").startsWith(MARKER)
    );
    if (existing?.uuid) {
      this.dataBlockUuid = existing.uuid;
      await logseq.Editor.updateBlock(existing.uuid, content);
    } else {
      const created = await logseq.Editor.insertBlock(PAGE, content, { isPageBlock: true });
      this.dataBlockUuid = created?.uuid || null;
    }
  }
}

const store = new TaskStore();

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Task | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    store.load()
      .then(setTasks)
      .catch((e) => setError(`Не удалось загрузить задачи: ${String(e)}`))
      .finally(() => setLoaded(true));
  }, []);

  async function commit(next: Task[]) {
    setSaving(true);
    setError("");
    try {
      await store.save(next);
      setTasks(next);
    } catch (e) {
      setError(`Ошибка сохранения в граф: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const visible = useMemo(() => tasks.filter((t) => {
    const statusMatch = filter === "all" || t.status === filter;
    const q = search.trim().toLowerCase();
    const textMatch = !q || [t.title, t.project, t.details].some((v) => v.toLowerCase().includes(q));
    return statusMatch && textMatch;
  }).sort((a, b) => {
    if (a.status === "done" && b.status !== "done") return 1;
    if (b.status === "done" && a.status !== "done") return -1;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  }), [tasks, filter, search]);

  function openNew() {
    setEditor(null);
    setShowForm(true);
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    if (!title) return;
    const now = new Date().toISOString();
    const old = editor;
    const task: Task = {
      id: old?.id || uid(),
      title,
      status: (form.get("status") as Status) || "todo",
      priority: (form.get("priority") as Priority) || "medium",
      dueDate: String(form.get("dueDate") || ""),
      project: String(form.get("project") || "").trim(),
      details: String(form.get("details") || "").trim(),
      createdAt: old?.createdAt || now,
      updatedAt: now
    };
    const next = old ? tasks.map((t) => t.id === old.id ? task : t) : [task, ...tasks];
    await commit(next);
    setShowForm(false);
    setEditor(null);
  }

  async function changeStatus(task: Task, status: Status) {
    await commit(tasks.map((t) => t.id === task.id ? { ...t, status, updatedAt: new Date().toISOString() } : t));
  }

  async function removeTask(task: Task) {
    if (!window.confirm(`Удалить задачу «${task.title}»?`)) return;
    await commit(tasks.filter((t) => t.id !== task.id));
  }

  const counts = {
    all: tasks.length,
    todo: tasks.filter((t) => t.status === "todo").length,
    doing: tasks.filter((t) => t.status === "doing").length,
    done: tasks.filter((t) => t.status === "done").length
  };

  if (!loaded) return <main className="app loading">Загружаю задачи…</main>;

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <div className="eyebrow">PERSONAL WORKSPACE</div>
          <h1>Рабочие задачи</h1>
          <p className="subtitle">Личный трекер задач внутри вашего графа Logseq</p>
        </div>
        <button className="primary" onClick={openNew}>＋ Новая задача</button>
      </header>

      <section className="stats">
        <Stat label="Всего" value={counts.all} active={filter === "all"} onClick={() => setFilter("all")} />
        <Stat label="К выполнению" value={counts.todo} active={filter === "todo"} onClick={() => setFilter("todo")} />
        <Stat label="В работе" value={counts.doing} active={filter === "doing"} onClick={() => setFilter("doing")} />
        <Stat label="Готово" value={counts.done} active={filter === "done"} onClick={() => setFilter("done")} />
      </section>

      <div className="toolbar">
        <input className="search" placeholder="Поиск по задачам, проектам и заметкам…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="save-state">{saving ? "Сохраняю…" : "● Сохранено в граф"}</span>
      </div>

      {error && <div className="error">{error}</div>}

      <section className="task-list">
        {visible.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">✓</div>
            <h2>{tasks.length ? "Ничего не найдено" : "Пока нет задач"}</h2>
            <p>{tasks.length ? "Измените фильтр или поисковый запрос." : "Добавьте первую задачу, чтобы спланировать работу."}</p>
            {!tasks.length && <button className="primary" onClick={openNew}>Создать задачу</button>}
          </div>
        ) : visible.map((task) => (
          <article className={`task ${task.status === "done" ? "is-done" : ""}`} key={task.id}>
            <button
              className={`check ${task.status === "done" ? "checked" : ""}`}
              title="Изменить статус"
              onClick={() => changeStatus(task, task.status === "done" ? "todo" : "done")}
            >{task.status === "done" ? "✓" : ""}</button>
            <div className="task-main">
              <div className="task-title-row">
                <h3>{task.title}</h3>
                <span className={`priority ${task.priority}`}>{priorityLabel(task.priority)}</span>
              </div>
              <div className="meta">
                {task.project && <span className="project">▦ {task.project}</span>}
                {task.dueDate && <span className={task.dueDate < new Date().toISOString().slice(0, 10) && task.status !== "done" ? "overdue" : ""}>◷ {formatDate(task.dueDate)}</span>}
                <span className={`status ${task.status}`}>{statusLabel(task.status)}</span>
              </div>
              {task.details && <p className="details">{task.details}</p>}
            </div>
            <div className="task-actions">
              <select aria-label="Статус задачи" value={task.status} onChange={(e) => changeStatus(task, e.target.value as Status)}>
                <option value="todo">К выполнению</option>
                <option value="doing">В работе</option>
                <option value="done">Готово</option>
              </select>
              <button className="icon-btn" title="Редактировать" onClick={() => { setEditor(task); setShowForm(true); }}>✎</button>
              <button className="icon-btn danger" title="Удалить" onClick={() => removeTask(task)}>×</button>
            </div>
          </article>
        ))}
      </section>

      <footer className="footer">
        <span>Данные хранятся на странице <strong>[[{PAGE}]]</strong></span>
        <button onClick={() => logseq.App.pushState("page", { name: PAGE })}>Открыть страницу данных ↗</button>
      </footer>

      {showForm && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <form className="modal" onSubmit={saveTask}>
            <div className="modal-head">
              <div><div className="eyebrow">TASK DETAILS</div><h2>{editor ? "Редактировать задачу" : "Новая задача"}</h2></div>
              <button type="button" className="icon-btn" onClick={() => setShowForm(false)}>×</button>
            </div>
            <label>Название задачи<input name="title" required autoFocus defaultValue={editor?.title || ""} placeholder="Например, подготовить отчёт" /></label>
            <div className="form-grid">
              <label>Статус<select name="status" defaultValue={editor?.status || "todo"}><option value="todo">К выполнению</option><option value="doing">В работе</option><option value="done">Готово</option></select></label>
              <label>Приоритет<select name="priority" defaultValue={editor?.priority || "medium"}><option value="low">Низкий</option><option value="medium">Средний</option><option value="high">Высокий</option></select></label>
              <label>Срок<input name="dueDate" type="date" defaultValue={editor?.dueDate || ""} /></label>
              <label>Проект<input name="project" defaultValue={editor?.project || ""} placeholder="Название проекта" /></label>
            </div>
            <label>Заметки<textarea name="details" rows={4} defaultValue={editor?.details || ""} placeholder="Контекст, следующие шаги, ссылки…" /></label>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setShowForm(false)}>Отмена</button>
              <button className="primary" type="submit" disabled={saving}>{saving ? "Сохранение…" : "Сохранить задачу"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return <button className={`stat ${active ? "active" : ""}`} onClick={onClick}><span>{label}</span><strong>{value}</strong></button>;
}
function statusLabel(s: Status) { return s === "todo" ? "К выполнению" : s === "doing" ? "В работе" : "Готово"; }
function priorityLabel(p: Priority) { return p === "high" ? "Высокий" : p === "low" ? "Низкий" : "Средний"; }
function formatDate(value: string) {
  const [y, m, d] = value.split("-");
  return `${d}.${m}.${y}`;
}

async function main() {
  logseq.setMainUIInlineStyle({
    width: "min(980px, 94vw)",
    height: "min(780px, 90vh)",
    zIndex: "999"
  });
  logseq.App.registerUIItem("toolbar", {
    key: "work-tracker-toolbar",
    template: `<a class="button" data-on-click="toggleWorkTracker" title="Рабочие задачи">✓</a>`
  });
  logseq.provideModel({
    toggleWorkTracker() {
      logseq.toggleMainUI();
    }
  });
  logseq.App.registerCommandPalette(
    { key: "open-work-tracker", label: "Work Tracker: открыть трекер задач" },
    () => logseq.showMainUI({ autoFocus: true })
  );
  logseq.provideStyle(`
    #work-tracker-toolbar { cursor: pointer; }
  `);
  logseq.showMainUI({ autoFocus: false });
  logseq.hideMainUI();
}

logseq.ready(main).catch(console.error);

createRoot(document.getElementById("root")!).render(<App />);
