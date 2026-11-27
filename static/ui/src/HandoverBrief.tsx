import { useMemo, useRef, useState } from 'react';
import { handoverBrief } from '../../../src/core/handover';
import type { Drill } from '../../../src/core/model';
import type { Pick } from './Items';

export function HandoverBrief({ drill, picks }: { drill: Drill; picks: Pick }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState('');
  const text = useMemo(
    () => handoverBrief(drill, Object.fromEntries(Object.entries(picks).map(([id, pick]) => [id, pick.to.accountId]))),
    [drill, picks],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Handover brief copied.');
    } catch {
      field.current?.focus();
      field.current?.select();
      setNotice('Text selected. Copy it with your keyboard or device menu.');
    }
  };

  return (
    <details className="handover-brief">
      <summary>Handover brief</summary>
      <p>Share the results of this drill and your current backup choices.</p>
      <textarea ref={field} aria-label="Handover brief text" readOnly rows={8} value={text} />
      <button type="button" className="btn ghost" onClick={() => void copy()}>Copy brief</button>
      <span className="brief-notice" role="status">{notice}</span>
    </details>
  );
}
