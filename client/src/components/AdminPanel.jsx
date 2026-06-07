import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', denied: 'Denied' };
const STATUS_CLASS = { pending: 'badge-pending', approved: 'badge-sent', denied: 'badge-failed' };
const DEFAULT_GRANT = 50;

export default function AdminPanel({ onError, onPendingChange }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // userId being actioned
  const [creditDraft, setCreditDraft] = useState({}); // userId -> string value
  const [grantDraft, setGrantDraft] = useState({}); // userId -> grant amount string

  const load = useCallback(async () => {
    try {
      const res = await api.listCreditUsers();
      const list = res.users || [];
      setUsers(list);
      onPendingChange?.(list.filter((u) => u.request?.status === 'pending').length);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setLoading(false);
    }
  }, [onError, onPendingChange]);

  useEffect(() => { load(); }, [load]);

  async function saveCredits(userId) {
    const raw = creditDraft[userId];
    const value = Math.max(0, Math.floor(Number(raw)));
    if (Number.isNaN(value)) {
      onError?.('Enter a valid credit number.');
      return;
    }
    setBusy(userId);
    try {
      await api.setUserCredits(userId, value);
      setCreditDraft((d) => { const n = { ...d }; delete n[userId]; return n; });
      await load();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function approve(user) {
    const grant = Math.max(0, Math.floor(Number(grantDraft[user.id] ?? DEFAULT_GRANT)));
    setBusy(user.id);
    try {
      await api.approveSubscription(user.request.id, '', grant);
      setGrantDraft((d) => { const n = { ...d }; delete n[user.id]; return n; });
      await load();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function deny(user) {
    setBusy(user.id);
    try {
      await api.denySubscription(user.request.id, '');
      await load();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(null);
    }
  }

  // Pending requests first, then everyone else.
  const sorted = useMemo(() => {
    const pending = users.filter((u) => u.request?.status === 'pending');
    const rest = users.filter((u) => u.request?.status !== 'pending');
    return [...pending, ...rest];
  }, [users]);

  const pendingCount = useMemo(
    () => users.filter((u) => u.request?.status === 'pending').length,
    [users],
  );

  if (loading) return null;

  return (
    <section className="card admin-panel">
      <h3>Admin — User Credits & Access</h3>
      {pendingCount > 0 ? (
        <p className="hint" style={{ color: '#d97706' }}>
          {pendingCount} pending request{pendingCount > 1 ? 's' : ''} awaiting review
        </p>
      ) : (
        <p className="hint">No pending requests. Adjust any user's credit balance below.</p>
      )}

      <div className="table-wrap">
        <table className="apps-table" style={{ fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Remaining</th>
              <th>Used</th>
              <th>Set credits</th>
              <th>Request</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => {
              const status = u.request?.status;
              const draft = creditDraft[u.id] ?? String(u.creditsRemaining);
              const dirty = creditDraft[u.id] !== undefined && Number(draft) !== u.creditsRemaining;
              return (
                <tr key={u.id} className={status === 'pending' ? 'group-first' : ''}>
                  <td>
                    {u.name || '—'}
                    {u.role === 'su' && <span className="badge badge-reviewed" style={{ marginLeft: 6 }}>SU</span>}
                    {u.hasOwnKey && (
                      <div className="muted small" title="Uses their own OpenAI key">own key</div>
                    )}
                  </td>
                  <td className="muted">{u.email}</td>
                  <td>
                    <strong style={{ color: u.creditsRemaining === 0 ? '#ef4444' : 'inherit' }}>
                      {u.creditsRemaining}
                    </strong>
                  </td>
                  <td className="muted">{u.creditsUsed}</td>
                  <td className="col-actions" style={{ whiteSpace: 'nowrap' }}>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={draft}
                      onChange={(e) => setCreditDraft((d) => ({ ...d, [u.id]: e.target.value }))}
                      style={{ width: 64, fontSize: '0.8rem', padding: '2px 6px' }}
                    />
                    <button
                      className="btn small"
                      disabled={busy === u.id || !dirty}
                      onClick={() => saveCredits(u.id)}
                      style={{ marginLeft: 4 }}
                    >
                      Set
                    </button>
                  </td>
                  <td className="muted small">
                    {status ? (
                      <span className={`badge ${STATUS_CLASS[status] || ''}`}>
                        {STATUS_LABEL[status] || status}
                      </span>
                    ) : (
                      '—'
                    )}
                    {u.request?.message && (
                      <div className="muted small" title={u.request.message} style={{ marginTop: 4 }}>
                        “{u.request.message.slice(0, 50)}{u.request.message.length > 50 ? '…' : ''}”
                      </div>
                    )}
                  </td>
                  <td className="col-actions" style={{ minWidth: 200 }}>
                    {status === 'pending' ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="muted small">Grant</span>
                        <input
                          className="input"
                          type="number"
                          min="0"
                          value={grantDraft[u.id] ?? DEFAULT_GRANT}
                          onChange={(e) => setGrantDraft((d) => ({ ...d, [u.id]: e.target.value }))}
                          style={{ width: 56, fontSize: '0.8rem', padding: '2px 6px' }}
                        />
                        <button className="btn small success" disabled={busy === u.id} onClick={() => approve(u)}>
                          Approve
                        </button>
                        <button className="btn small danger-ghost" disabled={busy === u.id} onClick={() => deny(u)}>
                          Deny
                        </button>
                      </div>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
