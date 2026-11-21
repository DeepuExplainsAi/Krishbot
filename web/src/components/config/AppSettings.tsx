import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Toolkit } from '@shared/types';
import { configApi } from '../../lib/configApi';
import { useConfigUI, type AppSection, type Theme } from '../../configStore';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { ToolkitLogo } from '../ToolkitLogo';
import { Glyph } from './glyphs';
import { Switch } from './ui';
import { ModelsSection } from './ModelsSection';

const SECTIONS: { id: AppSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'models', label: 'Models' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'apps', label: 'Connected apps' },
  { id: 'about', label: 'About' },
];

/** Full-window settings page, opened from the account menu. */
export function AppSettings() {
  const section = useConfigUI((s) => s.appSettings);
  const close = useConfigUI((s) => s.closeAppSettings);
  const open = useConfigUI((s) => s.openAppSettings);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.modal-root')) { e.preventDefault(); close(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [close]);
  if (!section) return null;
  return createPortal(
    <div className="app-settings" role="dialog" aria-modal="true" aria-label="Settings">
      <aside className="app-settings__nav">
        <button type="button" className="app-settings__back" onClick={close}><Glyph name="arrow_left" size={14} /> Back to Bots</button>
        <div className="app-settings__heading">Settings</div>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className={`cfg-nav__item${section === s.id ? ' is-active' : ''}`} onClick={() => open(s.id)} aria-current={section === s.id || undefined}>
            {s.label}
          </button>
        ))}
      </aside>
      <div className="app-settings__main">
        <button type="button" className="app-settings__close icon-btn" onClick={close} aria-label="Close settings" title="Close (Esc)"><Icon name="close" opacity={0.8} /></button>
        <div className="app-settings__page">
          {section === 'general' && <GeneralSection />}
          {section === 'models' && <ModelsSection />}
          {section === 'permissions' && <PermissionsSection />}
          {section === 'apps' && <AppsSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PageHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="app-settings__head">
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ThemeTile({ value, label, current, onPick }: { value: Theme; label: string; current: Theme; onPick: (t: Theme) => void }) {
  return (
    <button type="button" role="radio" aria-checked={current === value} className={`theme-tile${current === value ? ' is-active' : ''}`} onClick={() => onPick(value)}>
      <span className={`theme-tile__art is-${value}`} aria-hidden>
        <span className="theme-tile__side" />
        <span className="theme-tile__pane"><i /><i /><b /></span>
      </span>
      <span className="theme-tile__label">{label}</span>
    </button>
  );
}

function GeneralSection() {
  const theme = useConfigUI((s) => s.theme);
  const setTheme = useConfigUI((s) => s.setTheme);
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState('');
  useEffect(() => { configApi.getSettings().then((r) => setHasKey(!!r.settings.hasXaiKey)).catch(() => {}); }, []);
  const saveKey = () => configApi.setSettings({ xaiKey: key.trim() }).then((r) => { setHasKey(!!r.settings.hasXaiKey); setKey(''); }).catch(() => {});
  return (
    <>
      <PageHead title="General" />
      <section className="cfg-section">
        <div className="cfg-section__label">Theme</div>
        <div className="theme-tiles" role="radiogroup" aria-label="Theme">
          <ThemeTile value="system" label="System" current={theme} onPick={setTheme} />
          <ThemeTile value="light" label="Light" current={theme} onPick={setTheme} />
          <ThemeTile value="dark" label="Dark" current={theme} onPick={setTheme} />
        </div>
        <div className="cfg-field__hint">System follows your device’s light or dark setting.</div>
      </section>
      <section className="cfg-section">
        <div className="cfg-section__label">Voice and research</div>
        <div className="cfg-card">
          <div className="cfg-row">
            <div className="cfg-row__text">
              <div className="cfg-row__title">Voice and research key</div>
              <div className="cfg-row__sub">Optional. Your own key, kept on this computer. Turns on voice chat, dictation and X research. {hasKey ? 'A key is saved.' : 'No key yet.'}</div>
            </div>
            <input className="text-input" type="password" style={{ maxWidth: 200 }} value={key} placeholder={hasKey ? '••••••••' : 'Paste key'} onChange={(e) => setKey(e.target.value)} aria-label="Voice and research key" />
            <button type="button" className="cfg-btn cfg-btn--secondary" disabled={!key.trim()} onClick={saveKey}>Save</button>
          </div>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function humanizeTool(slug: string): { app: string; action: string } {
  const parts = slug.split(/[_:]/).filter(Boolean);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (parts.length < 2) return { app: cap(slug), action: '' };
  return { app: cap(parts[0]), action: cap(parts.slice(1).join(' ')) };
}

function PermissionsSection() {
  const [policies, setPolicies] = useState<{ tool: string; mode: string }[] | null>(null);
  const load = useCallback(() => { configApi.policies().then((r) => setPolicies(r.policies)).catch(() => setPolicies([])); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <PageHead title="Permissions" sub="Actions your Bots can take without asking first. Remove one and they’ll ask again next time." />
      <section className="cfg-section">
        <div className="cfg-card">
          {policies === null ? <div className="cfg-empty cfg-empty--flat">Loading…</div> : policies.length === 0 ? (
            <div className="cfg-empty cfg-empty--flat">Nothing here yet. When you choose “Always allow” on an approval, it shows up here.</div>
          ) : policies.map((p) => {
            const h = humanizeTool(p.tool);
            return (
              <div key={p.tool} className="cfg-row">
                <div className="cfg-row__text">
                  <div className="cfg-row__title">{h.app}{h.action ? ` · ${h.action}` : ''}</div>
                  <div className="cfg-row__sub">{p.mode === 'always_allow' ? 'Always allowed' : p.mode === 'blocked' ? 'Never allowed' : 'Asks first'} · <code className="cfg-code">{p.tool}</code></div>
                </div>
                <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => configApi.deletePolicy(p.tool).then(load).catch(() => {})}>Ask again</button>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function AppsSection() {
  const version = useStore((s) => s.connectionsVersion);
  const [apps, setApps] = useState<Toolkit[] | null>(null);
  useEffect(() => { configApi.connectedApps().then((r) => setApps(r.connectedApps ?? [])).catch(() => setApps([])); }, [version]);
  const openApps = () => { useConfigUI.getState().closeAppSettings(); useStore.getState().setModal('apps'); };
  return (
    <>
      <PageHead title="Connected apps" sub="Apps your Bots can use for you, like email, calendar and docs." />
      <section className="cfg-section">
        <div className="cfg-card">
          <div className="cfg-row">
            <div className="cfg-row__text">
              <div className="cfg-row__title">{apps === null ? 'Checking…' : apps.length ? `${apps.length} app${apps.length === 1 ? '' : 's'} connected` : 'No apps connected yet'}</div>
              <div className="cfg-row__sub">Bots ask before doing anything that changes data in an app.</div>
            </div>
            <button type="button" className="cfg-btn cfg-btn--primary" onClick={openApps}>{apps?.length ? 'Manage apps' : 'Connect apps'}</button>
          </div>
          {apps?.map((a) => (
            <div key={a.slug} className="cfg-row">
              <ToolkitLogo name={a.name} logo={a.logo} size={28} radius={7} />
              <div className="cfg-row__text">
                <div className="cfg-row__title">{a.name}</div>
                {a.description && <div className="cfg-row__sub">{a.description}</div>}
              </div>
              <span className="cfg-chip">Connected</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function AboutSection() {
  const [settings, setSettings] = useState<{ autoApprove: boolean; userName: string } | null>(null);
  useEffect(() => { configApi.getSettings().then((r) => setSettings(r.settings)).catch(() => {}); }, []);
  const patch = (p: Partial<{ autoApprove: boolean; userName: string }>) => { setSettings((s) => (s ? { ...s, ...p } : s)); configApi.setSettings(p).catch(() => {}); };
  return (
    <>
      <PageHead title="About" />
      <section className="cfg-section">
        <div className="cfg-card">
          <div className="cfg-row">
            <div className="cfg-row__text">
              <div className="cfg-row__title">Your name</div>
              <div className="cfg-row__sub">Bots use it to address you.</div>
            </div>
            <input className="text-input" style={{ maxWidth: 200 }} value={settings?.userName ?? ''} onChange={(e) => patch({ userName: e.target.value })} aria-label="Your name" />
          </div>
          <div className="cfg-row">
            <div className="cfg-row__text">
              <div className="cfg-row__title">Don’t ask before acting</div>
              <div className="cfg-row__sub">Skips every approval. Bots can run commands and change files on their own.</div>
            </div>
            <Switch on={!!settings?.autoApprove} onChange={(v) => patch({ autoApprove: v })} label="Don’t ask before acting" />
          </div>
        </div>
      </section>
      <section className="cfg-section">
        <div className="cfg-section__label">Krishbot</div>
        <div className="cfg-card">
          <div className="cfg-row"><div className="cfg-row__text">
            <div className="cfg-row__title">Krishbot 1.0.0</div>
            <div className="cfg-row__sub">Your AI Bots, running on your own computer. Your chats, files and keys stay on this machine.</div>
          </div></div>
          <div className="cfg-row"><div className="cfg-row__text">
            <div className="cfg-row__title">License</div>
            <div className="cfg-row__sub">Copyright © 2026 DeepuExplainsAi. Free software under the GNU Affero General Public License v3.0: you may use, change and share it, but modified versions (including ones run as a hosted service) must also be shared under the same license. Components made by others stay under their own licenses.</div>
          </div></div>
          <div className="cfg-row"><div className="cfg-row__text">
            <div className="cfg-row__sub"><a href="https://github.com/DeepuExplainsAi/Krishbot/blob/main/LICENSE" target="_blank" rel="noreferrer">Read the full license</a> · <a href="https://github.com/DeepuExplainsAi/Krishbot/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">Third-party notices</a></div>
          </div></div>
        </div>
      </section>
    </>
  );
}
