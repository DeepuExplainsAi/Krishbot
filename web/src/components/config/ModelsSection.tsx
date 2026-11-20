import { useCallback, useEffect, useState } from 'react';
import { configApi, type ModelConn, type ModelPreset } from '../../lib/configApi';
import { Switch } from './ui';

function PageHead({ title, sub }: { title: string; sub?: string }) {
  return <div className="app-settings__head"><h1>{title}</h1>{sub && <p>{sub}</p>}</div>;
}

function ModelRow({ preset, conn, onChange }: { preset: ModelPreset; conn?: ModelConn; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ apiKey: '', baseUrl: conn?.baseUrl ?? preset.baseUrl ?? '', model: conn?.model ?? preset.model ?? '', command: conn?.command ?? preset.command ?? '', trust: conn?.trust ?? true });
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const isCli = preset.type === 'cli';
  const connected = isCli ? !!preset.found || (preset.id === 'custom-cli' && !!conn?.command) : preset.needsKey ? !!conn?.apiKey : !!conn;
  const body = () => ({ id: preset.id, ...v, ...(v.apiKey ? {} : { apiKey: undefined }) });

  const save = async () => {
    setBusy('save'); setNote(null);
    try { await configApi.saveModel(preset.id, body()); onChange(); setOpen(false); }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); }
    finally { setBusy(null); }
  };
  const test = async () => {
    setBusy('test'); setNote(null);
    try { await configApi.saveModel(preset.id, body()); const r = await configApi.testModel({ id: preset.id }); setNote({ ok: true, text: `Works. It answered: “${r.reply}”` }); onChange(); }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); }
    finally { setBusy(null); }
  };

  return (
    <div className="cfg-card__item">
      <div className="cfg-row">
        <div className="cfg-row__text">
          <div className="cfg-row__title">{preset.label}</div>
          <div className="cfg-row__sub">{isCli && !preset.found && preset.id !== 'custom-cli' ? `Not found on this computer. ${preset.hint ?? ''}` : preset.hint ?? ''}</div>
        </div>
        {connected && <span className="cfg-chip">{isCli ? 'Ready' : 'Connected'}</span>}
        <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => setOpen(!open)}>{open ? 'Close' : connected ? 'Edit' : 'Set up'}</button>
      </div>
      {open && (
        <div className="cfg-form">
          {isCli ? (
            <>
              <label className="cfg-field__label">Command</label>
              <input className="text-input" value={v.command} placeholder="my-cli --print" spellCheck={false} onChange={(e) => setV({ ...v, command: e.target.value })} />
              <div className="cfg-row" style={{ padding: '8px 0' }}>
                <div className="cfg-row__text"><div className="cfg-row__sub">Let it act without asking. A command-line run has nobody to answer its questions, so it needs this to use tools.</div></div>
                <Switch on={v.trust} onChange={(trust) => setV({ ...v, trust })} label="Let it act without asking" />
              </div>
            </>
          ) : (
            <>
              {preset.type === 'openai' && (<><label className="cfg-field__label">Base URL</label><input className="text-input" value={v.baseUrl} placeholder="https://…/v1" spellCheck={false} onChange={(e) => setV({ ...v, baseUrl: e.target.value })} /></>)}
              {preset.needsKey && (<><label className="cfg-field__label">API key</label><input className="text-input" type="password" value={v.apiKey} placeholder={conn?.apiKey ? 'Saved. Type to replace.' : 'Paste your key'} autoComplete="off" onChange={(e) => setV({ ...v, apiKey: e.target.value })} /></>)}
              <label className="cfg-field__label">Model</label>
              <input className="text-input" list={`pm-${preset.id}`} value={v.model} placeholder="Model name" spellCheck={false} onChange={(e) => setV({ ...v, model: e.target.value })} />
              <datalist id={`pm-${preset.id}`}>{preset.models?.map((m) => <option key={m} value={m} />)}</datalist>
            </>
          )}
          {note && <div className={note.ok ? 'cfg-field__hint' : 'cfg-error cfg-error--small'}>{note.text}</div>}
          <div className="cfg-form__actions">
            <button type="button" className="cfg-btn cfg-btn--primary" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            <button type="button" className="cfg-btn cfg-btn--secondary" disabled={!!busy} onClick={test}>{busy === 'test' ? 'Testing…' : 'Save and test'}</button>
            {conn && <button type="button" className="cfg-btn cfg-btn--ghost-danger" disabled={!!busy} onClick={() => configApi.removeModel(preset.id).then(onChange)}>Remove</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ModelsSection() {
  const [data, setData] = useState<{ presets: ModelPreset[]; connections: ModelConn[] } | null>(null);
  const load = useCallback(() => { configApi.models().then(setData).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const groups = [...new Set(data?.presets.map((p) => p.group))];
  return (
    <>
      <PageHead title="Models" sub="Connect the AI your Bots think with. Use a plan you already pay for, a free one, or your own key. Everything is sent straight from this computer." />
      {!data ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : groups.map((g) => (
        <section key={g} className="cfg-section">
          <div className="cfg-section__label">{g}</div>
          <div className="cfg-card">
            {data.presets.filter((p) => p.group === g).map((p) => <ModelRow key={p.id} preset={p} conn={data.connections.find((c) => c.id === p.id)} onChange={load} />)}
          </div>
        </section>
      ))}
    </>
  );
}
