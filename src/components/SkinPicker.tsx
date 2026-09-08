'use client';

import { SKINS, setSkin, skinStore } from '@/lib/skins';
import { useStore } from '@/lib/store-util';

/** Bottom sheet listing skins as swatches. */
export function SkinPicker({ onClose }: { onClose: () => void }) {
  const { id } = useStore(skinStore);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">Skin</div>
        <div className="skins">
          {SKINS.map((s) => (
            <button
              key={s.id}
              className={`skin${s.id === id ? ' on' : ''}`}
              style={{ background: s.vars['--bg'], borderColor: s.id === id ? s.vars['--accent'] : s.vars['--line'] }}
              onClick={() => void setSkin(s.id)}
            >
              <span className="swatch" style={{ background: s.vars['--panel-2'] }}>
                <span style={{ background: s.vars['--accent'] }} />
                <span style={{ background: s.vars['--lcd-text'] }} />
                <span style={{ background: s.vars['--text-dim'] }} />
              </span>
              <span className="skin-name" style={{ color: s.vars['--text'] }}>{s.name}</span>
            </button>
          ))}
        </div>
        <div className="sheet-actions">
          <button className="import-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
