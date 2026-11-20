import { useCallback, useEffect, useState } from 'react';
import type { Bot, EngineInfo } from '@shared/types';
import { configApi } from '../lib/configApi';
import { useConfigUI } from '../configStore';
import { Icon } from './Icon';

const KIND = { subscription: 'Subscription', api_key: 'API key' } as const;

/** "Engine" section of the details panel: which connected model runs this bot. */
export function EngineSettings({ bot }: { bot: Bot }) {
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    configApi.engine(bot.id).then(({ engine: e }) => { setEngine(e); setProvider(e.provider ?? ''); setModel(e.model ?? ''); }).catch(() => setEngine(null));
  }, [bot.id]);
  useEffect(() => { setEngine(null); setNote(null); load(); }, [load]);

  if (!engine) return <div className="panel-card"><div className="panel-empty">Checking…</div></div>;

  const connected = engine.providers.filter((p) => p.connected);
  const selected = engine.providers.find((p) => p.id === provider);
  const changed = provider !== (engine.provider ?? '') || model.trim() !== (engine.model ?? '');
  const pick = (id: string) => { setProvider(id); const next = engine.providers.find((p) => p.id === id); if (next?.models.length && !next.models.includes(model)) setModel(next.models[0]); };
  const save = async () => {
    setBusy(true); setNote(null);
    try { const r = await configApi.setEngine(bot.id, { provider, model: model.trim() }); setEngine(r.engine); }
    catch (e) { setNote(`Couldn’t save: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="panel-card engine">
      <div className="panel-row panel-row--setting">
        <span>Provider</span>
        <span className="mini-select mini-select--native engine__select">
          <span>{selected?.name ?? 'Choose…'}</span>
          <Icon name="chev_down" size={10} opacity={0.66} />
          <select aria-label="Provider" value={provider} onChange={(e) => pick(e.target.value)}>
            {!selected && <option value="">Choose…</option>}
            {connected.map((p) => <option key={p.id} value={p.id}>{p.name} · {KIND[p.kind]}</option>)}
          </select>
        </span>
      </div>
      <div className="panel-row panel-row--setting">
        <label htmlFor={`m-${bot.id}`}>Model</label>
        <input id={`m-${bot.id}`} className="engine__model" list={`ml-${bot.id}`} value={model} spellCheck={false} autoComplete="off" placeholder={selected?.models[0] ?? 'Default'} onChange={(e) => setModel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && changed) save(); }} />
        <datalist id={`ml-${bot.id}`}>{selected?.models.map((m) => <option key={m} value={m} />)}</datalist>
      </div>
      <div className="engine__actions">
        <button type="button" className="btn btn--sm btn--bot" onClick={save} disabled={!changed || busy}>{busy ? 'Saving…' : 'Save'}</button>
        {changed && <button type="button" className="link-btn link-btn--small" onClick={() => { setProvider(engine.provider ?? ''); setModel(engine.model ?? ''); }}>Undo</button>}
      </div>
      <button type="button" className="panel-row panel-row--action engine__signin" onClick={() => useConfigUI.getState().openAppSettings('models')}>
        <Icon name="monitor" size={14} opacity={0.56} />
        {connected.length ? 'Manage models…' : 'Connect a model…'}
      </button>
      {note && <div className="voice-error" role="alert">{note}</div>}
      <div className="engine__meta">
        <span className={`engine__state is-${engine.status}`}><i aria-hidden />{engine.status === 'ready' ? 'Ready' : 'No model connected'}</span>
      </div>
      {engine.status === 'error' && engine.error && <div className="engine__error">{engine.error}</div>}
    </div>
  );
}
