"use client";

/**
 * RepeaterList — generic add/remove/reorder list editor.
 *
 *   <RepeaterList
 *     items={items}
 *     onChange={setItems}
 *     newItem={() => ({ q: "", a: "" })}
 *     renderRow={(item, set, i) => (
 *       <Field label="Question" value={item.q} onChange={(v) => set({ ...item, q: v })} />
 *     )}
 *     summary={(item) => item.q}   // optional — collapsed-row preview
 *     addLabel="Add FAQ row"
 *   />
 *
 * Each row is wrapped in a <details> so long lists collapse cleanly; the
 * row also exposes up / down / delete buttons. Add row appends an empty
 * one. Drag-reorder is not supported in v1 — up/down buttons are
 * sufficient and keyboard-friendly.
 */

import { ChevronUp, ChevronDown, Trash2, Plus, ChevronRight } from "lucide-react";

interface RepeaterListProps<T> {
  items: T[];
  onChange: (next: T[]) => void;
  newItem: () => T;
  renderRow: (item: T, set: (next: T) => void, index: number) => React.ReactNode;
  summary?: (item: T, index: number) => string;
  addLabel?: string;
  emptyLabel?: string;
}

export function RepeaterList<T>({
  items,
  onChange,
  newItem,
  renderRow,
  summary,
  addLabel = "Add row",
  emptyLabel = "No items yet.",
}: RepeaterListProps<T>) {
  function setAt(index: number, next: T) {
    const copy = items.slice();
    copy[index] = next;
    onChange(copy);
  }
  function removeAt(index: number) {
    const copy = items.slice();
    copy.splice(index, 1);
    onChange(copy);
  }
  function moveUp(index: number) {
    if (index === 0) return;
    const copy = items.slice();
    [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]];
    onChange(copy);
  }
  function moveDown(index: number) {
    if (index === items.length - 1) return;
    const copy = items.slice();
    [copy[index + 1], copy[index]] = [copy[index], copy[index + 1]];
    onChange(copy);
  }
  function add() {
    onChange([...items, newItem()]);
  }

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground italic">{emptyLabel}</p>
      )}
      {items.map((item, i) => (
        <details
          key={i}
          open
          className="group rounded-lg border border-emerald-500/25 bg-white [&_summary::-webkit-details-marker]:hidden"
        >
          <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90 shrink-0" />
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 shrink-0">
              #{i + 1}
            </span>
            <span className="text-xs text-foreground/80 truncate flex-1 min-w-0">
              {summary ? summary(item, i) || "(empty)" : `Item ${i + 1}`}
            </span>
            <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.preventDefault()}>
              <IconButton
                onClick={() => moveUp(i)}
                disabled={i === 0}
                title="Move up"
                icon={<ChevronUp className="h-3.5 w-3.5" />}
              />
              <IconButton
                onClick={() => moveDown(i)}
                disabled={i === items.length - 1}
                title="Move down"
                icon={<ChevronDown className="h-3.5 w-3.5" />}
              />
              <IconButton
                onClick={() => removeAt(i)}
                title="Remove"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                destructive
              />
            </div>
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-2 border-t border-emerald-500/15">
            {renderRow(item, (next) => setAt(i, next), i)}
          </div>
        </details>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/[0.04] hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </button>
    </div>
  );
}

function IconButton({
  onClick,
  disabled,
  title,
  icon,
  destructive,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  icon: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-6 w-6 inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        destructive
          ? "text-rose-600 hover:bg-rose-500/10"
          : "text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15"
      }`}
    >
      {icon}
    </button>
  );
}

/**
 * Lightweight string-only repeater for plain bullet lists (e.g.
 * "Instructions", "What you'll learn"). Removes the nested <details>
 * wrapping to keep the UI compact.
 */
export function StringList({
  items,
  onChange,
  placeholder = "New item…",
  addLabel = "Add item",
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  function setAt(index: number, value: string) {
    const copy = items.slice();
    copy[index] = value;
    onChange(copy);
  }
  function removeAt(index: number) {
    const copy = items.slice();
    copy.splice(index, 1);
    onChange(copy);
  }
  function moveUp(index: number) {
    if (index === 0) return;
    const copy = items.slice();
    [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]];
    onChange(copy);
  }
  function moveDown(index: number) {
    if (index === items.length - 1) return;
    const copy = items.slice();
    [copy[index + 1], copy[index]] = [copy[index], copy[index + 1]];
    onChange(copy);
  }

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-emerald-700/70 dark:text-emerald-300/70 w-5 shrink-0">
            {i + 1}.
          </span>
          <input
            type="text"
            value={item}
            onChange={(e) => setAt(i, e.target.value)}
            placeholder={placeholder}
            className="flex-1 h-9 px-2.5 rounded-md border border-emerald-500/30 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60 transition-shadow"
          />
          <IconButton onClick={() => moveUp(i)} disabled={i === 0} title="Move up" icon={<ChevronUp className="h-3.5 w-3.5" />} />
          <IconButton onClick={() => moveDown(i)} disabled={i === items.length - 1} title="Move down" icon={<ChevronDown className="h-3.5 w-3.5" />} />
          <IconButton onClick={() => removeAt(i)} title="Remove" icon={<Trash2 className="h-3.5 w-3.5" />} destructive />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/[0.04] hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </button>
    </div>
  );
}
