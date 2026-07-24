import { createFileRoute } from "@tanstack/react-router";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
  UserRound,
  X,
} from "lucide-react";

export const Route = createFileRoute("/staff/schedule")({
  component: Schedule,
});

type CalendarView = "day" | "week" | "month";

type ScheduledTask = {
  id: string;
  title: string;
  priority: string;
  status: string;
  due_at: string;
  owner_name: string | null;
  organization_name: string | null;
  project_name: string | null;
  deal_title: string | null;
};

const priorityClass: Record<string, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-brand-blue/15 text-brand-blue",
  high: "bg-brand-orange/15 text-brand-orange",
  critical: "bg-destructive/15 text-destructive",
};

const statusDotClass: Record<string, string> = {
  open: "bg-emerald-500",
  blocked: "bg-destructive",
};

const viewOptions: CalendarView[] = ["day", "week", "month"];
const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function taskDateKey(task: ScheduledTask) {
  return task.due_at.slice(0, 10);
}

function taskDate(task: ScheduledTask) {
  return new Date(task.due_at);
}

function taskTime(value: string) {
  return new Date(value).toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function taskContext(task: ScheduledTask) {
  return task.project_name ?? task.organization_name ?? task.deal_title ?? "Unlinked";
}

function viewTitle(view: CalendarView, date: Date) {
  if (view === "day") return format(date, "EEEE, d MMMM yyyy");
  if (view === "week") {
    const start = startOfWeek(date, { weekStartsOn: 1 });
    const end = endOfWeek(date, { weekStartsOn: 1 });
    return `${format(start, "d MMM")} - ${format(end, "d MMM yyyy")}`;
  }
  return format(date, "MMMM yyyy");
}

function moveDate(date: Date, view: CalendarView, direction: -1 | 1) {
  if (view === "day") return direction === 1 ? addDays(date, 1) : subDays(date, 1);
  if (view === "week") return direction === 1 ? addWeeks(date, 1) : subWeeks(date, 1);
  return direction === 1 ? addMonths(date, 1) : subMonths(date, 1);
}

function tasksInRange(tasks: ScheduledTask[], start: Date, end: Date) {
  return tasks
    .filter((task) => {
      const due = taskDate(task);
      return due >= start && due <= end;
    })
    .sort((a, b) => taskDate(a).getTime() - taskDate(b).getTime());
}

function Schedule() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [error, setError] = useState("");
  const [view, setView] = useState<CalendarView>("month");
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [activeTask, setActiveTask] = useState<ScheduledTask | null>(null);

  useEffect(() => {
    fetch("/api/schedule")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Schedule failed to load");
        setTasks(body.tasks);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Schedule failed to load"));
  }, []);

  const tasksByDate = useMemo(() => {
    const groups = new Map<string, ScheduledTask[]>();
    for (const task of tasks) {
      const key = taskDateKey(task);
      groups.set(key, [...(groups.get(key) ?? []), task]);
    }
    for (const [key, items] of groups) {
      groups.set(
        key,
        [...items].sort((a, b) => taskDate(a).getTime() - taskDate(b).getTime()),
      );
    }
    return groups;
  }, [tasks]);

  const calendarDays = useMemo(() => {
    if (view === "day") return [focusDate];
    if (view === "week") {
      return eachDayOfInterval({
        start: startOfWeek(focusDate, { weekStartsOn: 1 }),
        end: endOfWeek(focusDate, { weekStartsOn: 1 }),
      });
    }
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(focusDate), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(focusDate), { weekStartsOn: 1 }),
    });
  }, [focusDate, view]);

  const todaysTasks = tasksByDate.get(dayKey(new Date()))?.length ?? 0;
  const visibleTasks = tasksInRange(
    tasks,
    view === "day"
      ? startOfDay(focusDate)
      : view === "week"
        ? startOfWeek(focusDate, { weekStartsOn: 1 })
        : startOfMonth(focusDate),
    view === "day"
      ? endOfDay(focusDate)
      : view === "week"
        ? endOfWeek(focusDate, { weekStartsOn: 1 })
        : endOfMonth(focusDate),
  );

  function goToday() {
    const today = new Date();
    setFocusDate(today);
  }

  return (
    <div className="flex min-h-[calc(100vh-7.5rem)] flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-surface p-4 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-blue/15 text-brand-blue">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Operations Calendar</div>
            <h1 className="text-2xl font-bold">{viewTitle(view, focusDate)}</h1>
            <p className="text-sm text-muted-foreground">
              Full-page schedule with expandable event details.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1">
            {viewOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
                  view === option
                    ? "bg-white text-brand-blue shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFocusDate((date) => moveDate(date, view, -1))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border/70 bg-white text-muted-foreground transition hover:border-brand-blue/40 hover:text-brand-blue"
              aria-label="Previous period"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToday}
              className="inline-flex h-10 items-center rounded-md bg-brand-blue px-4 text-sm font-medium text-white transition hover:bg-brand-blue/90"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setFocusDate((date) => moveDate(date, view, 1))}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border/70 bg-white text-muted-foreground transition hover:border-brand-blue/40 hover:text-brand-blue"
              aria-label="Next period"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center sm:w-72">
            <Stat label="Total" value={tasks.length} />
            <Stat label="Visible" value={visibleTasks.length} />
            <Stat label="Today" value={todaysTasks} />
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-surface shadow-sm">
        {view === "day" && (
          <DayView
            date={focusDate}
            tasks={tasksByDate.get(dayKey(focusDate)) ?? []}
            onOpenTask={setActiveTask}
          />
        )}
        {view === "week" && (
          <WeekView days={calendarDays} tasksByDate={tasksByDate} onOpenTask={setActiveTask} />
        )}
        {view === "month" && (
          <MonthView
            days={calendarDays}
            focusDate={focusDate}
            tasksByDate={tasksByDate}
            onFocusDate={setFocusDate}
            onOpenTask={setActiveTask}
          />
        )}
      </section>

      {activeTask && <EventDialog task={activeTask} onClose={() => setActiveTask(null)} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/60 bg-white px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold leading-tight">{value}</div>
    </div>
  );
}

function DayView({
  date,
  tasks,
  onOpenTask,
}: {
  date: Date;
  tasks: ScheduledTask[];
  onOpenTask: (task: ScheduledTask) => void;
}) {
  return (
    <div className="flex h-full min-h-[520px] flex-col">
      <div className="border-b border-border/60 bg-surface-2/50 px-5 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {format(date, "EEEE")}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={`grid h-9 min-w-9 place-items-center rounded-full px-2 text-sm font-bold ${
              isToday(date) ? "bg-brand-blue text-white" : "bg-white text-foreground"
            }`}
          >
            {format(date, "d")}
          </span>
          <span className="text-sm text-muted-foreground">{tasks.length} scheduled items</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tasks.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {tasks.map((task) => (
              <EventCard key={task.id} task={task} size="large" onOpenTask={onOpenTask} />
            ))}
          </div>
        ) : (
          <EmptyCalendarMessage message="No scheduled work for this day." />
        )}
      </div>
    </div>
  );
}

function WeekView({
  days,
  tasksByDate,
  onOpenTask,
}: {
  days: Date[];
  tasksByDate: Map<string, ScheduledTask[]>;
  onOpenTask: (task: ScheduledTask) => void;
}) {
  return (
    <div className="grid h-full min-h-[560px] grid-cols-1 overflow-y-auto md:grid-cols-7 md:overflow-hidden">
      {days.map((date) => {
        const tasks = tasksByDate.get(dayKey(date)) ?? [];
        return (
          <div
            key={dayKey(date)}
            className="flex min-h-[220px] flex-col border-b border-r border-border/50 md:min-h-0"
          >
            <div className="sticky top-0 z-10 border-b border-border/50 bg-surface-2/90 px-3 py-3 backdrop-blur">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {format(date, "EEE")}
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span
                  className={`grid h-8 min-w-8 place-items-center rounded-full px-2 text-sm font-bold ${
                    isToday(date) ? "bg-brand-blue text-white" : "bg-white text-foreground"
                  }`}
                >
                  {format(date, "d")}
                </span>
                <span className="text-xs text-muted-foreground">{tasks.length}</span>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {tasks.length > 0 ? (
                tasks.map((task) => (
                  <EventCard key={task.id} task={task} size="compact" onOpenTask={onOpenTask} />
                ))
              ) : (
                <div className="rounded-md border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
                  No events
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({
  days,
  focusDate,
  tasksByDate,
  onFocusDate,
  onOpenTask,
}: {
  days: Date[];
  focusDate: Date;
  tasksByDate: Map<string, ScheduledTask[]>;
  onFocusDate: (date: Date) => void;
  onOpenTask: (task: ScheduledTask) => void;
}) {
  return (
    <div className="flex h-full min-h-[620px] flex-col overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border/60 bg-surface-2/50">
        {weekDays.map((day) => (
          <div
            key={day}
            className="px-2 py-3 text-center text-xs font-semibold text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto sm:grid-cols-7 sm:overflow-hidden">
        {days.map((date) => {
          const key = dayKey(date);
          const tasks = tasksByDate.get(key) ?? [];
          const inMonth = isSameMonth(date, focusDate);
          return (
            <div
              key={key}
              className={`min-h-[180px] border-b border-r border-border/50 p-2 sm:min-h-0 ${
                inMonth ? "bg-white" : "bg-slate-50/80"
              }`}
            >
              <button
                type="button"
                onClick={() => onFocusDate(date)}
                className="mb-2 flex w-full items-center justify-between gap-2 text-left"
              >
                <span
                  className={`grid h-7 min-w-7 place-items-center rounded-full px-2 text-xs font-bold ${
                    isToday(date)
                      ? "bg-brand-blue text-white"
                      : inMonth
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  {format(date, "d")}
                </span>
                {tasks.length > 0 && (
                  <span className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-[11px] font-medium text-brand-blue">
                    {tasks.length}
                  </span>
                )}
              </button>

              <div className="space-y-1.5 overflow-hidden">
                {tasks.slice(0, 4).map((task) => (
                  <EventCard key={task.id} task={task} size="mini" onOpenTask={onOpenTask} />
                ))}
                {tasks.length > 4 && (
                  <button
                    type="button"
                    onClick={() => onFocusDate(date)}
                    className="w-full rounded-md bg-slate-100 px-2 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-slate-200"
                  >
                    +{tasks.length - 4} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventCard({
  task,
  size,
  onOpenTask,
}: {
  task: ScheduledTask;
  size: "mini" | "compact" | "large";
  onOpenTask: (task: ScheduledTask) => void;
}) {
  const compact = size === "mini" || size === "compact";
  return (
    <button
      type="button"
      onClick={() => onOpenTask(task)}
      className={`w-full rounded-md border border-border/60 bg-white text-left shadow-sm transition hover:border-brand-blue/40 hover:shadow-md ${
        size === "large" ? "p-4" : "px-2 py-2"
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
            statusDotClass[task.status] ?? "bg-brand-blue"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div
            className={`${compact ? "truncate text-xs" : "text-sm"} font-semibold text-foreground`}
          >
            {task.title}
          </div>
          <div
            className={`${compact ? "mt-0.5 truncate text-[11px]" : "mt-2 text-xs"} text-muted-foreground`}
          >
            {taskTime(task.due_at)} · {task.owner_name ?? "Unassigned"}
          </div>
          {!compact && (
            <div className="mt-3 rounded-md bg-surface-2/70 px-3 py-2 text-xs text-muted-foreground">
              {taskContext(task)}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function EventDialog({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 p-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-blue">
              Scheduled item
            </div>
            <h2 className="mt-1 text-xl font-bold">{task.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {format(taskDate(task), "EEEE, d MMMM yyyy")} at {taskTime(task.due_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            aria-label="Close event details"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Detail
              label="Owner"
              value={task.owner_name ?? "Unassigned"}
              icon={<UserRound className="h-4 w-4" />}
            />
            <Detail
              label="Time"
              value={taskTime(task.due_at)}
              icon={<Clock3 className="h-4 w-4" />}
            />
            <Detail label="Priority" value={task.priority} />
            <Detail label="Status" value={task.status} />
          </div>

          <div className="rounded-lg border border-border/60 bg-surface-2/70 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Context
            </div>
            <div className="mt-2 text-sm font-medium">{taskContext(task)}</div>
            {task.organization_name && (
              <div className="mt-1 text-sm text-muted-foreground">
                Organization: {task.organization_name}
              </div>
            )}
            {task.project_name && (
              <div className="mt-1 text-sm text-muted-foreground">Project: {task.project_name}</div>
            )}
            {task.deal_title && (
              <div className="mt-1 text-sm text-muted-foreground">Deal: {task.deal_title}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-white p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-medium capitalize">{value}</div>
    </div>
  );
}

function EmptyCalendarMessage({ message }: { message: string }) {
  return (
    <div className="grid min-h-80 place-items-center rounded-lg border border-dashed border-border/70 bg-surface-2/50 p-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
