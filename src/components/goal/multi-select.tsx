"use client";
import * as React from "react";
import { Check, Plus, X } from "lucide-react";

interface MultiSelectProps {
  /** Currently selected values. */
  values: string[];
  onChange: (next: string[]) => void;
  /** Suggested options shown in the dropdown. */
  options: string[];
  /** Optional display labels keyed by option value (e.g. body-type codes). */
  optionLabels?: Record<string, string>;
  /** Allow adding values that are not in `options`. Defaults to true. */
  allowCustom?: boolean;
  placeholder?: string;
  /** Ties the filter input to an external <label htmlFor>. */
  id?: string;
}

export function MultiSelect({
  values,
  onChange,
  options,
  optionLabels,
  allowCustom = true,
  placeholder = "Type to search…",
  id,
}: MultiSelectProps) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const labelFor = (value: string) => optionLabels?.[value] ?? value;

  // Close the dropdown when clicking outside the component.
  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = new Set(values);
  const trimmedQuery = query.trim();
  const q = trimmedQuery.toLowerCase();

  const suggestions = options.filter(
    (opt) => !selected.has(opt) && labelFor(opt).toLowerCase().includes(q),
  );

  // Offer a custom entry only when it isn't already an option or selected.
  const canAddCustom =
    allowCustom &&
    trimmedQuery.length > 0 &&
    !selected.has(trimmedQuery) &&
    !options.some((opt) => opt.toLowerCase() === q);

  function add(value: string) {
    const v = value.trim();
    if (!v || selected.has(v)) return;
    onChange([...values, v]);
    setQuery("");
  }

  function remove(value: string) {
    onChange(values.filter((v) => v !== value));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions.length > 0) add(suggestions[0]);
      else if (canAddCustom) add(trimmedQuery);
    } else if (e.key === "Backspace" && query === "" && values.length > 0) {
      remove(values[values.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div
        className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 focus-within:ring-2 focus-within:ring-accent"
        onClick={() => setOpen(true)}
      >
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-text-secondary"
          >
            {labelFor(value)}
            <button
              type="button"
              aria-label={`Remove ${labelFor(value)}`}
              className="text-text-muted hover:text-text-primary"
              onClick={(e) => {
                e.stopPropagation();
                remove(value);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={query}
          placeholder={values.length === 0 ? placeholder : ""}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>

      {open && (suggestions.length > 0 || canAddCustom) && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-md">
          {suggestions.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text-primary hover:bg-surface-hover"
                onClick={() => add(opt)}
              >
                <Check className="h-3.5 w-3.5 opacity-0" />
                {labelFor(opt)}
              </button>
            </li>
          ))}
          {canAddCustom && (
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-accent hover:bg-surface-hover"
                onClick={() => add(trimmedQuery)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add “{trimmedQuery}”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
