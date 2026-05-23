"use client";

/**
 * <EditableList> — wraps an array of items rendered on a creator page
 * with admin-only reorder/add/delete controls.
 *
 *   <EditableList
 *     isAdmin={isAdmin}
 *     slug="brief"
 *     path={["faq", "items"]}
 *     items={c.faq.items}
 *     newItem={() => ({ q: "New question", a: "" })}
 *     renderItem={(item, i, isAdmin) => (
 *       <details key={i}>
 *         <Editable isAdmin={isAdmin} slug="brief" path={["faq","items",i,"q"]} value={item.q}>
 *           <summary>{item.q}</summary>
 *         </Editable>
 *         …
 *       </details>
 *     )}
 *   />
 *
 * Public visitors get just the rendered items, in order, with zero
 * extra DOM. Admins get a tiny toolbar in the top-right of each item
 * and an "Add" button at the bottom of the list.
 */

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Loader2,
} from "lucide-react";
import { updateCmsField } from "@/app/(dashboard)/signup-control/actions";
import type { Path } from "@/lib/cms-inline-helpers";
import type { CmsSlug } from "@/lib/cms-schemas";

interface EditableListProps<T> {
  isAdmin: boolean;
  slug: CmsSlug;
  path: Path;
  items: T[];
  newItem: () => T;
  renderItem: (item: T, index: number, isAdmin: boolean) => ReactNode;
  /** When true, the per-item toolbar is rendered. Defaults to true. */
  showItemControls?: boolean;
}

export function EditableList<T>({
  isAdmin,
  slug,
  path,
  items,
  newItem,
  renderItem,
  showItemControls = true,
}: EditableListProps<T>) {
  if (!isAdmin) {
    return <>{items.map((item, i) => renderItem(item, i, false))}</>;
  }

  return (
    <AdminEditableList
      slug={slug}
      path={path}
      items={items}
      newItem={newItem}
      renderItem={renderItem}
      showItemControls={showItemControls}
    />
  );
}

function AdminEditableList<T>({
  slug,
  path,
  items,
  newItem,
  renderItem,
  showItemControls,
}: Omit<EditableListProps<T>, "isAdmin">) {
  const router = useRouter();
  const [busy, setBusy] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);

  async function commit(next: T[]) {
    setBusy("saving");
    setError(null);
    const res = await updateCmsField(slug, path, next);
    setBusy("idle");
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  function moveUp(i: number) {
    if (i === 0) return;
    const next = items.slice();
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    commit(next);
  }
  function moveDown(i: number) {
    if (i === items.length - 1) return;
    const next = items.slice();
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    commit(next);
  }
  function remove(i: number) {
    if (!confirm("Delete this item? This can be restored from version history.")) return;
    const next = items.slice();
    next.splice(i, 1);
    commit(next);
  }
  function add() {
    const next = [...items, newItem()];
    commit(next);
  }

  return (
    <>
      {items.map((item, i) => (
        <span key={i} className="relative block group/listrow">
          {renderItem(item, i, true)}
          {showItemControls && (
            <span
              className="absolute top-2 right-2 hidden group-hover/listrow:inline-flex items-center gap-0.5 rounded-md bg-white shadow-md ring-1 ring-emerald-500/30 p-0.5 z-10"
              // Stop the toolbar from triggering parent click handlers (e.g. <summary>).
              onClick={(e) => e.stopPropagation()}
            >
              <ItemBtn onClick={() => moveUp(i)} disabled={i === 0 || busy === "saving"} title="Move up">
                <ChevronUp className="h-3.5 w-3.5" />
              </ItemBtn>
              <ItemBtn onClick={() => moveDown(i)} disabled={i === items.length - 1 || busy === "saving"} title="Move down">
                <ChevronDown className="h-3.5 w-3.5" />
              </ItemBtn>
              <ItemBtn onClick={() => remove(i)} disabled={busy === "saving"} title="Delete" destructive>
                <Trash2 className="h-3.5 w-3.5" />
              </ItemBtn>
            </span>
          )}
        </span>
      ))}
      <button
        type="button"
        onClick={add}
        disabled={busy === "saving"}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/[0.04] hover:bg-emerald-500/10 text-emerald-700 text-xs font-semibold disabled:opacity-50 mt-2"
      >
        {busy === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Add item
      </button>
      {error && (
        <p className="text-[11px] text-destructive mt-1">{error}</p>
      )}
    </>
  );
}

function ItemBtn({
  children,
  onClick,
  disabled,
  title,
  destructive,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-6 w-6 inline-flex items-center justify-center rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        destructive
          ? "text-rose-600 hover:bg-rose-500/10"
          : "text-emerald-700 hover:bg-emerald-500/15"
      }`}
    >
      {children}
    </button>
  );
}
