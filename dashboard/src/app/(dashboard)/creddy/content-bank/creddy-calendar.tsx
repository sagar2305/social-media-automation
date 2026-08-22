"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { rescheduleCreddyAction } from "./actions";

type Entry = {
  id: string;
  hook: string;
  format: "text_music" | "narrated";
  platform: "instagram" | "tiktok";
  account: string;
  scheduledFor: string;
  status: "pending" | "submitted" | "draft_sent" | "blotato_draft" | "scheduled" | "publishing" | "published" | "failed";
};

function dateKey(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function CreddyCalendar({ entries }: { entries: Entry[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return date;
  });

  async function move(entry: Entry, day: Date) {
    if (entry.status !== "pending") return;
    const original = new Date(entry.scheduledFor);
    const target = new Date(day);
    target.setHours(original.getHours(), original.getMinutes(), 0, 0);
    if (target <= new Date()) {
      target.setHours(new Date().getHours() + 1, 0, 0, 0);
    }
    const key = `${entry.platform}:${entry.account}:${entry.format}`;
    const form = new FormData();
    form.set("id", entry.id);
    form.set("destination_key", key);
    form.set("scheduled_for", target.toISOString());
    setBusy(`${entry.id}:${key}`);
    setError(null);
    try {
      await rescheduleCreddyAction(form);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to move scheduled post");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Drag a pending post to another day. Its local posting time is preserved; submitted posts are locked.</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid min-w-[900px] grid-cols-7 gap-2 overflow-x-auto">
        {days.map((day) => {
          const key = dateKey(day);
          return (
            <div
              key={key}
              className="min-h-40 rounded-lg border bg-muted/20 p-2"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const index = Number(event.dataTransfer.getData("text/plain"));
                if (Number.isInteger(index) && entries[index]) void move(entries[index], day);
              }}
            >
              <div className="mb-2 text-xs font-semibold">{day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
              <div className="space-y-2">
                {entries.map((entry, index) => dateKey(new Date(entry.scheduledFor)) === key ? (
                  <div
                    key={`${entry.id}-${entry.platform}-${entry.account}-${entry.format}`}
                    draggable={entry.status === "pending" && !busy}
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", String(index))}
                    className="cursor-grab rounded-md border bg-card p-2 text-xs shadow-sm"
                  >
                    <div className="font-medium line-clamp-2">{entry.hook}</div>
                    <div className="mt-1 text-muted-foreground">{new Date(entry.scheduledFor).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · {entry.platform} · {entry.format}</div>
                  </div>
                ) : null)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
