import { useEffect, useId, useRef, useState } from 'react';
import type { Person } from '../../../src/core/model';
import { api } from './api';
import { Avatar } from './ui';

export function PersonPicker({ value, onChange }: { value: Person | null; onChange: (p: Person | null) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) return setResults([]);
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      api
        .people(query)
        .then((r) => live && (setResults(r), setActive(0), setOpen(true)))
        .catch(() => live && setResults([]))
        .finally(() => live && setBusy(false));
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const pick = (p: Person) => {
    onChange(p);
    setOpen(false);
    setQuery('');
  };

  if (value) {
    return (
      <button type="button" className="chosen" onClick={() => (onChange(null), setTimeout(() => input.current?.focus()))} aria-label={`${value.name}, change person`}>
        <Avatar person={value} size={44} />
        <span>{value.name}</span>
        <span className="chosen-x" aria-hidden="true">change</span>
      </button>
    );
  }

  return (
    <div className="picker">
      <input
        ref={input}
        className="picker-input"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Who is out?"
        placeholder="Type a teammate's name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(results.length - 1, a + 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
          else if (e.key === 'Enter' && results[active]) pick(results[active]);
          else return;
          e.preventDefault();
        }}
      />
      {busy && <span className="picker-spin" aria-hidden="true" />}
      {open && results.length > 0 && (
        <ul className="picker-list" id={listId} role="listbox">
          {results.map((p, i) => (
            <li key={p.accountId} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseDown={() => pick(p)} onMouseEnter={() => setActive(i)}>
              <Avatar person={p} size={28} />
              {p.name}
            </li>
          ))}
        </ul>
      )}
      {open && !busy && query.trim().length >= 2 && results.length === 0 && <p className="picker-none">No active people match "{query}".</p>}
    </div>
  );
}
