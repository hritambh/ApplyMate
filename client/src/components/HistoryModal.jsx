import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function HistoryModal({ onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { history } = await api.getHistory();
        if (active) setHistory(history || []);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760, width: '90%' }}
      >
        <header className="modal-header">
          <div>
            <h2>Mail & follow-up history</h2>
            <p className="muted small">Every initial send and follow-up, newest first.</p>
          </div>
          <button className="btn ghost" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          {loading && <p className="muted">Loading history…</p>}
          {error && <p className="error-msg">{error}</p>}
          {!loading && !error && history.length === 0 && (
            <p className="muted">No emails sent yet.</p>
          )}

          {!loading && !error && history.length > 0 && (
            <table className="apps-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Company / Role</th>
                  <th>Recipient</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((ev) => (
                  <tr key={ev.id}>
                    <td className="small">
                      {ev.sentAt ? new Date(ev.sentAt).toLocaleString() : '—'}
                    </td>
                    <td>
                      {ev.type === 'followup' ? (
                        <span className="badge" style={{ background: '#ede9fe', color: '#7c3aed' }}>
                          ↩ follow-up #{ev.sequence}
                        </span>
                      ) : (
                        <span className="badge badge-sent">initial</span>
                      )}
                    </td>
                    <td>
                      <div>{ev.company}</div>
                      <div className="muted small">{ev.role}</div>
                    </td>
                    <td>
                      <div>{ev.hrName || <span className="muted">No HR name</span>}</div>
                      <div className="muted small">{ev.address}</div>
                    </td>
                    <td>
                      {ev.status === 'sent' ? (
                        <span className="badge badge-sent">sent</span>
                      ) : (
                        <span className="badge badge-failed" title={ev.error || ''}>
                          failed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
