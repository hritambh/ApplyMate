import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', denied: 'Denied' };
const STATUS_CLASS = { pending: 'badge-pending', approved: 'badge-sent', denied: 'badge-failed' };

export default function AdminPanel({ onError, onPendingChange }) {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // id of item being actioned
  const [reviewNote, setReviewNote] = useState('');
  const [noteFor, setNoteFor] = useState(null); // id of item showing note input

  const load = useCallback(async () => {
    try {
      const res = await api.listSubscriptions();
      const subs = res.subscriptions || [];
      setSubscriptions(subs);
      onPendingChange?.(subs.filter((s) => s.status === 'pending').length);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setLoading(false);
    }
  }, [onError, onPendingChange]);

  useEffect(() => { load(); }, [load]);

  async function action(id, type) {
    setBusy(id);
    try {
      const note = noteFor === id ? reviewNote : '';
      if (type === 'approve') await api.approveSubscription(id, note);
      else if (type === 'deny') await api.denySubscription(id, note);
      else if (type === 'revoke') await api.revokeSubscription(id);
      setNoteFor(null);
      setReviewNote('');
      await load();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(null);
    }
  }

  const pending = subscriptions.filter((s) => s.status === 'pending');
  const rest = subscriptions.filter((s) => s.status !== 'pending');

  if (loading) return null;
  if (subscriptions.length === 0) {
    return (
      <section className="card admin-panel">
        <h3>Admin — OpenAI Access Requests</h3>
        <p className="muted">No subscription requests yet.</p>
      </section>
    );
  }

  return (
    <section className="card admin-panel">
      <h3>Admin — OpenAI Access Requests</h3>
      {pending.length > 0 && (
        <p className="hint" style={{ color: '#d97706' }}>
          {pending.length} pending request{pending.length > 1 ? 's' : ''} awaiting review
        </p>
      )}
      <div className="table-wrap">
        <table className="apps-table" style={{ fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Status</th>
              <th>Message</th>
              <th>Requested</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {[...pending, ...rest].map((sub) => (
              <tr key={sub.id} className={sub.status === 'pending' ? 'group-first' : ''}>
                <td>{sub.user.name || '—'}</td>
                <td className="muted">{sub.user.email}</td>
                <td>
                  <span className={`badge ${STATUS_CLASS[sub.status] || ''}`}>
                    {STATUS_LABEL[sub.status] || sub.status}
                  </span>
                </td>
                <td className="muted small">{sub.message || '—'}</td>
                <td className="muted small">{new Date(sub.createdAt).toLocaleDateString()}</td>
                <td className="col-actions" style={{ minWidth: 180 }}>
                  {sub.status === 'pending' && (
                    <>
                      {noteFor === sub.id ? (
                        <div style={{ display: 'flex', gap: 4, flexDirection: 'column' }}>
                          <input
                            className="input"
                            placeholder="Note (optional)"
                            value={reviewNote}
                            onChange={(e) => setReviewNote(e.target.value)}
                            style={{ fontSize: '0.8rem', padding: '2px 6px' }}
                          />
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              className="btn small success"
                              disabled={busy === sub.id}
                              onClick={() => action(sub.id, 'approve')}
                            >
                              Approve
                            </button>
                            <button
                              className="btn small danger-ghost"
                              disabled={busy === sub.id}
                              onClick={() => action(sub.id, 'deny')}
                            >
                              Deny
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="btn small"
                          onClick={() => { setNoteFor(sub.id); setReviewNote(''); }}
                        >
                          Review
                        </button>
                      )}
                    </>
                  )}
                  {sub.status === 'approved' && (
                    <button
                      className="btn small danger-ghost"
                      disabled={busy === sub.id}
                      onClick={() => action(sub.id, 'revoke')}
                    >
                      Revoke
                    </button>
                  )}
                  {sub.status === 'denied' && (
                    <button
                      className="btn small"
                      disabled={busy === sub.id}
                      onClick={() => action(sub.id, 'approve')}
                    >
                      Approve
                    </button>
                  )}
                  {sub.reviewNote && (
                    <div className="muted small" title={sub.reviewNote}>
                      Note: {sub.reviewNote.slice(0, 40)}{sub.reviewNote.length > 40 ? '…' : ''}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
