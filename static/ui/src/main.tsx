import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/inter';
import './styles.css';
import { view } from '@forge/bridge';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Panel } from './Panel';

const root = createRoot(document.getElementById('root')!);
void view
  .getContext()
  .catch(() => ({}))
  .then((c) => {
    const panel = (c as { extension?: { type?: string } }).extension?.type === 'jira:issuePanel';
    root.render(<StrictMode>{panel ? <Panel /> : <App />}</StrictMode>);
  });
