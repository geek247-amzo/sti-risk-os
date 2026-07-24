import { createFileRoute, Link } from "@tanstack/react-router";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Bot,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  History,
  Loader2,
  Save,
  Send,
  User,
  X,
  MessageSquare,
  MoreHorizontal,
  Plus,
} from "lucide-react";

export const Route = createFileRoute("/staff/work")({
  component: WorkBoard,
});

type Task = {
  id: string;
  stageId: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "critical";
  status: "open" | "blocked" | "done" | "cancelled";
  dueAt: string | null;
  projectName: string | null;
  organizationName: string | null;
  dealTitle: string | null;
  ownerId: string | null;
  ownerName: string | null;
  comments: number;
};

type Stage = {
  id: string;
  name: string;
  position: number;
  isTerminal: boolean;
  tasks: Task[];
};

type Owner = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type ViewMode = "kanban" | "list" | "calendar";

type TaskDetail = {
  task: {
    id: string;
    board_id: string | null;
    stage_id: string | null;
    project_id: string | null;
    deliverable_id: string | null;
    deal_id: string | null;
    organization_id: string | null;
    owner_id: string | null;
    title: string;
    description: string | null;
    priority: Task["priority"];
    status: Task["status"];
    due_at: string | null;
    completed_at: string | null;
    source: string;
    created_at: string;
    updated_at: string;
    stage_name: string | null;
    owner_name: string | null;
    owner_email: string | null;
    organization_name: string | null;
    deal_title: string | null;
    project_name: string | null;
    deliverable_title: string | null;
  };
  comments: {
    id: string;
    body: string;
    created_at: string;
    author_name: string | null;
    author_email: string | null;
  }[];
  history: {
    id: string;
    created_at: string;
    actor_name: string | null;
    from_stage_name: string | null;
    to_stage_name: string | null;
  }[];
};

const priorityClass: Record<Task["priority"], string> = {
  low: "bg-surface-2 text-muted-foreground",
  medium: "bg-brand-blue/15 text-brand-blue",
  high: "bg-brand-orange/15 text-brand-orange",
  critical: "bg-destructive/20 text-destructive",
};

const stageDot = [
  "bg-muted-foreground",
  "bg-brand-blue",
  "bg-brand-orange",
  "bg-amber-400",
  "bg-emerald-400",
];

const statusDot: Record<Task["status"], string> = {
  open: "bg-brand-blue",
  blocked: "bg-destructive",
  done: "bg-emerald-500",
  cancelled: "bg-muted-foreground",
};

const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDue(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  const today = new Date();
  const days = Math.floor((date.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return date.toLocaleDateString();
}

function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function taskTime(value: string | null) {
  if (!value) return "No time";
  return new Date(value).toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name: string | null) {
  return (name ?? "ST")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function taskContext(task: Task) {
  return task.projectName ?? task.organizationName ?? task.dealTitle ?? "Unlinked";
}

function dateInputValue(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function WorkBoard() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [view, setView] = useState<ViewMode>("kanban");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [showNewTask, setShowNewTask] = useState(false);
  const [error, setError] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [moving, setMoving] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    const response = await fetch("/api/tasks");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Work board failed to load");
    setStages(body.stages);
    setOwners(body.owners ?? []);
  }

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : "Work board failed to load"),
    );
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeTask();
    }
    if (selectedTaskId) window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedTaskId]);

  const filteredStages = useMemo(() => {
    return stages.map((stage) => ({
      ...stage,
      tasks:
        ownerFilter === "all"
          ? stage.tasks
          : stage.tasks.filter((task) => task.ownerName === ownerFilter),
    }));
  }, [ownerFilter, stages]);

  const allTasks = useMemo(() => filteredStages.flatMap((stage) => stage.tasks), [filteredStages]);

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [visibleMonth]);

  const tasksByDate = useMemo(() => {
    const groups = new Map<string, Task[]>();
    for (const task of allTasks) {
      if (!task.dueAt) continue;
      const key = task.dueAt.slice(0, 10);
      groups.set(key, [...(groups.get(key) ?? []), task]);
    }

    for (const [key, tasks] of groups) {
      groups.set(
        key,
        [...tasks].sort((a, b) => {
          if (!a.dueAt || !b.dueAt) return 0;
          return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
        }),
      );
    }

    return groups;
  }, [allTasks]);

  const selectedDateTasks = tasksByDate.get(dayKey(selectedDate)) ?? [];
  const noDueDateTasks = allTasks.filter((task) => !task.dueAt);
  const visibleMonthTasks = allTasks.filter(
    (task) => task.dueAt && isSameMonth(new Date(task.dueAt), visibleMonth),
  );

  async function moveTask(taskId: string, stageId: string) {
    setMoving(taskId);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/stage`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stageId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to move task");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to move task");
    } finally {
      setMoving("");
    }
  }

  async function openTask(taskId: string) {
    setSelectedTaskId(taskId);
    setTaskDetail(null);
    setDetailError("");
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/tasks/${taskId}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Task detail failed to load");
      setTaskDetail(body);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Task detail failed to load");
    } finally {
      setLoadingDetail(false);
    }
  }

  function closeTask() {
    setSelectedTaskId("");
    setTaskDetail(null);
    setDetailError("");
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTaskId) return;
    setSavingDetail(true);
    setDetailError("");
    try {
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      const response = await fetch(`/api/tasks/${selectedTaskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save task");
      await load();
      await openTask(selectedTaskId);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Unable to save task");
    } finally {
      setSavingDetail(false);
    }
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTaskId) return;
    setCommenting(true);
    setDetailError("");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch(`/api/tasks/${selectedTaskId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to add comment");
      event.currentTarget.reset();
      await load();
      await openTask(selectedTaskId);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Unable to add comment");
    } finally {
      setCommenting(false);
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to create task");
      event.currentTarget.reset();
      setShowNewTask(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create task");
    } finally {
      setCreating(false);
    }
  }

  function stageIdForTask(taskId: string) {
    return stages.find((stage) => stage.tasks.some((task) => task.id === taskId))?.id ?? "";
  }

  function taskCard(task: Task, stageId: string) {
    return (
      <article
        key={task.id}
        onClick={() => openTask(task.id)}
        className="group cursor-pointer rounded-md border border-border/60 bg-surface p-3 transition hover:border-brand-blue/50 hover:shadow-sm"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{task.id.slice(0, 8)}</span>
            {task.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
            {task.status === "blocked" && (
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            )}
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openTask(task.id);
            }}
            className="text-muted-foreground opacity-0 transition group-hover:opacity-100"
            title="Open task"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        <h4 className="mt-2 text-sm font-medium leading-snug">{task.title}</h4>
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Briefcase className="h-3 w-3" />
          {taskContext(task)}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityClass[task.priority]}`}
          >
            {task.priority}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <CalendarClock className="h-3 w-3" /> {formatDue(task.dueAt)}
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2.5">
          <div
            className="grid h-6 w-6 place-items-center rounded-full border-2 border-surface bg-brand-blue/25 text-[10px] font-semibold text-brand-blue"
            title={task.ownerName ?? "Unassigned"}
          >
            {initials(task.ownerName)}
          </div>
          <div className="flex items-center gap-2">
            {task.comments > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <MessageSquare className="h-3 w-3" /> {task.comments}
              </span>
            )}
            <select
              disabled={moving === task.id}
              value={stageId}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                event.stopPropagation();
                moveTask(task.id, event.target.value);
              }}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand-orange"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Operations</div>
          <h1 className="text-2xl font-bold">Work Board</h1>
          <p className="text-sm text-muted-foreground">
            Live tasks linked back to leads, deals, projects, deliverables, and automation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-md border border-border bg-surface p-0.5 text-xs">
            {(["kanban", "list", "calendar"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={`rounded-sm px-3 py-1.5 capitalize ${
                  view === mode
                    ? "bg-surface-2 font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
            <Filter className="h-4 w-4" />
            <select
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              className="bg-transparent text-sm outline-none"
            >
              <option value="all">All owners</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.name}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
          <Link
            to="/staff/chat"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-2"
          >
            <Bot className="h-4 w-4" /> Ask Steve
          </Link>
          <button
            type="button"
            onClick={() => setShowNewTask((value) => !value)}
            className="inline-flex items-center gap-2 rounded-md bg-brand-orange px-3 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> New Task
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {showNewTask && (
        <form
          onSubmit={createTask}
          className="grid gap-3 rounded-lg border border-border/60 bg-surface p-4 md:grid-cols-[minmax(180px,1fr)_160px_160px_160px_auto]"
        >
          <input
            name="title"
            required
            placeholder="Task title"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <select
            name="ownerEmail"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            {owners.map((owner) => (
              <option key={owner.id} value={owner.email}>
                {owner.name}
              </option>
            ))}
          </select>
          <select
            name="priority"
            defaultValue="medium"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <input
            name="dueAt"
            type="date"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand-orange"
          />
          <button
            disabled={creating}
            className="inline-flex h-10 items-center justify-center rounded-md bg-brand-orange px-4 text-sm font-semibold text-primary-foreground disabled:opacity-70"
          >
            {creating ? "Creating" : "Create"}
          </button>
        </form>
      )}

      {view === "kanban" && (
        <div className="-mx-6 overflow-x-auto pb-4">
          <div className="flex min-w-max gap-4 px-6">
            {filteredStages.map((stage, stageIndex) => (
              <div
                key={stage.id}
                className="flex w-80 shrink-0 flex-col rounded-lg border border-border/60 bg-surface/60"
              >
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${stageDot[stageIndex] ?? "bg-brand-blue"}`}
                    />
                    <h3 className="text-sm font-semibold">{stage.name}</h3>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
                      {stage.tasks.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNewTask(true)}
                    className="text-muted-foreground hover:text-foreground"
                    title={`Add task to ${stage.name}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 space-y-3 p-3">
                  {stage.tasks.map((task) => taskCard(task, stage.id))}
                  {stage.tasks.length === 0 && (
                    <div className="rounded-md border border-dashed border-border/70 p-4 text-center text-sm text-muted-foreground">
                      No tasks
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "list" && (
        <div className="overflow-hidden rounded-lg border border-border/60 bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Owner</th>
                <th className="hidden px-4 py-3 lg:table-cell">Context</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredStages.flatMap((stage) =>
                stage.tasks.map((task) => (
                  <tr
                    key={task.id}
                    onClick={() => openTask(task.id)}
                    className="cursor-pointer hover:bg-surface-2/60"
                  >
                    <td className="px-4 py-3 font-medium">{task.title}</td>
                    <td className="px-4 py-3">{task.ownerName ?? "Unassigned"}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                      {taskContext(task)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityClass[task.priority]}`}
                      >
                        {task.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDue(task.dueAt)}</td>
                    <td className="px-4 py-3">
                      <select
                        disabled={moving === task.id}
                        value={stage.id}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          event.stopPropagation();
                          moveTask(task.id, event.target.value);
                        }}
                        className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand-orange"
                      >
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )),
              )}
              {allTasks.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No tasks match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view === "calendar" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="overflow-hidden rounded-lg border border-border/60 bg-surface shadow-sm">
            <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-blue/15 text-brand-blue">
                  <CalendarClock className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-semibold">{format(visibleMonth, "MMMM yyyy")}</h2>
                  <p className="text-xs text-muted-foreground">
                    {visibleMonthTasks.length} scheduled tasks this month
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleMonth((month) => subMonths(month, 1))}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-white text-muted-foreground transition hover:border-brand-blue/40 hover:text-brand-blue"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date();
                    setVisibleMonth(today);
                    setSelectedDate(today);
                  }}
                  className="inline-flex h-9 items-center rounded-md bg-brand-blue px-4 text-sm font-medium text-white transition hover:bg-brand-blue/90"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-white text-muted-foreground transition hover:border-brand-blue/40 hover:text-brand-blue"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-7 border-b border-border/60 bg-surface-2/50">
                  {weekDays.map((day) => (
                    <div
                      key={day}
                      className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground"
                    >
                      {day}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7">
                  {calendarDays.map((date) => {
                    const key = dayKey(date);
                    const dayTasks = tasksByDate.get(key) ?? [];
                    const hiddenCount = Math.max(dayTasks.length - 3, 0);
                    const selected = isSameDay(date, selectedDate);
                    const inMonth = isSameMonth(date, visibleMonth);

                    return (
                      <div
                        key={key}
                        className={`min-h-[148px] border-b border-r border-border/50 p-3 ${
                          inMonth ? "bg-white" : "bg-slate-50/80 text-muted-foreground"
                        } ${selected ? "ring-2 ring-inset ring-brand-blue" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedDate(date)}
                          className="mb-2 flex w-full items-center justify-between gap-2 text-left"
                        >
                          <span
                            className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold ${
                              isToday(date) ? "bg-brand-blue text-white" : "text-foreground"
                            }`}
                          >
                            {format(date, "d")}
                          </span>
                          {dayTasks.length > 0 && (
                            <span className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-[11px] font-medium text-brand-blue">
                              {dayTasks.length}
                            </span>
                          )}
                        </button>

                        <div className="space-y-1.5">
                          {dayTasks.slice(0, 3).map((task) => (
                            <button
                              key={task.id}
                              type="button"
                              onClick={() => openTask(task.id)}
                              className="w-full rounded-md border border-border/50 bg-white px-2 py-1.5 text-left shadow-sm transition hover:border-brand-blue/50 hover:bg-brand-blue/5"
                            >
                              <div className="flex items-start gap-1.5">
                                <span
                                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${statusDot[task.status]}`}
                                />
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-foreground">
                                    {task.title}
                                  </div>
                                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                    {task.ownerName ?? "Unassigned"} · {taskTime(task.dueAt)}
                                  </div>
                                </div>
                              </div>
                            </button>
                          ))}

                          {hiddenCount > 0 && (
                            <button
                              type="button"
                              onClick={() => setSelectedDate(date)}
                              className="w-full rounded-md bg-slate-100 px-2 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-slate-200"
                            >
                              +{hiddenCount} more
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-lg border border-border/60 bg-surface shadow-sm">
              <div className="border-b border-border/60 px-5 py-4">
                <div className="text-xs text-muted-foreground">Selected day</div>
                <h2 className="mt-1 text-lg font-semibold">
                  {format(selectedDate, "EEEE, d MMMM yyyy")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedDateTasks.length} scheduled{" "}
                  {selectedDateTasks.length === 1 ? "task" : "tasks"}
                </p>
              </div>

              <div className="divide-y divide-border/50">
                {selectedDateTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => openTask(task.id)}
                    className="block w-full px-5 py-4 text-left transition hover:bg-surface-2/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold leading-5">{task.title}</h3>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3.5 w-3.5" />
                            {taskTime(task.dueAt)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            {task.ownerName ?? "Unassigned"}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${priorityClass[task.priority]}`}
                      >
                        {task.priority}
                      </span>
                    </div>
                    <div className="mt-3 rounded-md bg-surface-2/70 px-3 py-2 text-xs text-muted-foreground">
                      {taskContext(task)}
                    </div>
                  </button>
                ))}

                {selectedDateTasks.length === 0 && (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                    No scheduled work on this day.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border/60 bg-surface shadow-sm">
              <div className="border-b border-border/60 px-5 py-4">
                <h2 className="text-sm font-semibold">No due date</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {noDueDateTasks.length} tasks need scheduling
                </p>
              </div>
              <div className="max-h-[360px] divide-y divide-border/50 overflow-y-auto">
                {noDueDateTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => openTask(task.id)}
                    className="block w-full px-5 py-3 text-left transition hover:bg-surface-2/60"
                  >
                    <div className="truncate text-sm font-medium">{task.title}</div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{task.ownerName ?? "Unassigned"}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${priorityClass[task.priority]}`}
                      >
                        {task.priority}
                      </span>
                    </div>
                  </button>
                ))}

                {noDueDateTasks.length === 0 && (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                    All matching tasks have due dates.
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}

      {selectedTaskId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
          <button
            type="button"
            aria-label="Close task detail"
            className="hidden flex-1 cursor-default md:block"
            onClick={closeTask}
          />
          <aside className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-blue">
                  Task detail
                </div>
                <h2 className="mt-1 truncate text-lg font-semibold">
                  {taskDetail?.task.title ?? "Loading task..."}
                </h2>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {selectedTaskId.slice(0, 8)}
                </div>
              </div>
              <button
                type="button"
                onClick={closeTask}
                className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {loadingDetail && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading task detail...
                </div>
              )}

              {detailError && (
                <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  {detailError}
                </div>
              )}

              {taskDetail && (
                <div className="space-y-6">
                  <form
                    key={`${taskDetail.task.id}-${taskDetail.task.updated_at}`}
                    onSubmit={saveTask}
                    className="space-y-4"
                  >
                    <label className="block space-y-1.5 text-sm">
                      <span className="font-medium">Title</span>
                      <input
                        name="title"
                        required
                        defaultValue={taskDetail.task.title}
                        className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-blue"
                      />
                    </label>

                    <label className="block space-y-1.5 text-sm">
                      <span className="font-medium">Description</span>
                      <textarea
                        name="description"
                        defaultValue={taskDetail.task.description ?? ""}
                        rows={4}
                        className="w-full resize-y rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
                      />
                    </label>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block space-y-1.5 text-sm">
                        <span className="font-medium">Owner</span>
                        <select
                          name="ownerId"
                          defaultValue={taskDetail.task.owner_id ?? ""}
                          className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-blue"
                        >
                          <option value="">Unassigned</option>
                          {owners.map((owner) => (
                            <option key={owner.id} value={owner.id}>
                              {owner.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block space-y-1.5 text-sm">
                        <span className="font-medium">Due date</span>
                        <input
                          name="dueAt"
                          type="date"
                          defaultValue={dateInputValue(taskDetail.task.due_at)}
                          className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-blue"
                        />
                      </label>

                      <label className="block space-y-1.5 text-sm">
                        <span className="font-medium">Priority</span>
                        <select
                          name="priority"
                          defaultValue={taskDetail.task.priority}
                          className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-blue"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </label>

                      <label className="block space-y-1.5 text-sm">
                        <span className="font-medium">Status</span>
                        <select
                          name="status"
                          defaultValue={taskDetail.task.status}
                          className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-blue"
                        >
                          <option value="open">Open</option>
                          <option value="blocked">Blocked</option>
                          <option value="done">Done</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </label>

                      <label className="block space-y-1.5 text-sm md:col-span-2">
                        <span className="font-medium">Stage</span>
                        <select
                          name="stageId"
                          defaultValue={taskDetail.task.stage_id ?? ""}
                          className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-brand-blue"
                        >
                          {stages.map((stage) => (
                            <option key={stage.id} value={stage.id}>
                              {stage.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <button
                      disabled={savingDetail}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand-blue px-4 text-sm font-semibold text-white hover:brightness-105 disabled:opacity-70"
                    >
                      {savingDetail ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      {savingDetail ? "Saving" : "Save changes"}
                    </button>
                  </form>

                  <section className="rounded-md border border-border bg-surface p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <Briefcase className="h-4 w-4 text-brand-blue" />
                      Linked context
                    </div>
                    <div className="grid gap-3 text-sm md:grid-cols-2">
                      {[
                        ["Organization", taskDetail.task.organization_name],
                        ["Deal", taskDetail.task.deal_title],
                        ["Project", taskDetail.task.project_name],
                        ["Deliverable", taskDetail.task.deliverable_title],
                        ["Source", taskDetail.task.source],
                        [
                          "Updated",
                          taskDetail.task.updated_at
                            ? new Date(taskDetail.task.updated_at).toLocaleString()
                            : null,
                        ],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <div className="text-xs uppercase tracking-wider text-muted-foreground">
                            {label}
                          </div>
                          <div className="mt-1 font-medium">{value ?? "Unlinked"}</div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-md border border-border bg-surface p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <MessageSquare className="h-4 w-4 text-brand-blue" />
                      Comments
                    </div>
                    <div className="space-y-3">
                      {taskDetail.comments.map((comment) => (
                        <article key={comment.id} className="rounded-md bg-white p-3 text-sm">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <User className="h-3.5 w-3.5" />
                            <span className="font-medium text-foreground">
                              {comment.author_name ?? "Staff user"}
                            </span>
                            <span>{new Date(comment.created_at).toLocaleString()}</span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap">{comment.body}</p>
                        </article>
                      ))}
                      {taskDetail.comments.length === 0 && (
                        <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                          No comments yet.
                        </div>
                      )}
                    </div>

                    <form onSubmit={addComment} className="mt-4 space-y-2">
                      <textarea
                        name="body"
                        required
                        rows={3}
                        placeholder="Add a comment..."
                        className="w-full resize-y rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
                      />
                      <button
                        disabled={commenting}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-semibold hover:bg-surface-2 disabled:opacity-70"
                      >
                        {commenting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        {commenting ? "Adding" : "Add comment"}
                      </button>
                    </form>
                  </section>

                  <section className="rounded-md border border-border bg-surface p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <History className="h-4 w-4 text-brand-blue" />
                      Stage history
                    </div>
                    <div className="space-y-3">
                      {taskDetail.history.map((item) => (
                        <div key={item.id} className="flex gap-3 text-sm">
                          <span className="mt-1 h-2 w-2 rounded-full bg-brand-blue" />
                          <div>
                            <div>
                              <span className="font-medium">
                                {item.from_stage_name ?? "No stage"}
                              </span>{" "}
                              <span className="text-muted-foreground">to</span>{" "}
                              <span className="font-medium">
                                {item.to_stage_name ?? "No stage"}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {item.actor_name ?? "Staff user"} ·{" "}
                              {new Date(item.created_at).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))}
                      {taskDetail.history.length === 0 && (
                        <div className="text-sm text-muted-foreground">
                          No stage changes recorded yet.
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
