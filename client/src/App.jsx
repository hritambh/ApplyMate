import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  getRecipientEmails,
  isEmailChecking,
  isEmailSendable,
  isGroupGenerating,
} from './api.js';
import ResumeCard from './components/ResumeCard.jsx';
import BulkAddForm from './components/BulkAddForm.jsx';
import ApplicationsTable from './components/ApplicationsTable.jsx';
import ReviewModal from './components/ReviewModal.jsx';

export default function App() {
  const [health, setHealth] = useState(null);
  const [resume, setResume] = useState(null);
  const [applications, setApplications] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [showBulk, setShowBulk] = useState(false);
  const [reviewId, setReviewId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [h, r, a] = await Promise.all([
        api.health(),
        api.getResume(),
        api.listApplications(),
      ]);
      setHealth(h);
      setResume(r.resume);
      setApplications(a.applications);
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const busy =
      applications.some((g) => isGroupGenerating(g)) || isEmailChecking(applications);
    if (!busy) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [applications, refresh]);

  const reviewTarget = useMemo(
    () => applications.find((a) => a.id === reviewId) || null,
    [applications, reviewId],
  );

  const toggleSelect = (emailId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(emailId)) next.delete(emailId);
      else next.add(emailId);
      return next;
    });
  };

  const sendableEmailIds = useMemo(() => {
    const ids = [];
    for (const g of applications) {
      for (const r of g.recipients || []) {
        for (const e of getRecipientEmails(r)) {
          if (isEmailSendable(g, e)) ids.push(e.id);
        }
      }
    }
    return ids;
  }, [applications]);

  const selectAll = () => setSelected(new Set(sendableEmailIds));
  const clearSelection = () => setSelected(new Set());

  const handleBulkAdd = async (companies) => {
    setBusy(true);
    setBanner(null);
    try {
      const res = await api.createApplications(companies);
      setShowBulk(false);
      const groupCount = res.applications?.length ?? 0;
      const emailCount = companies.reduce((n, c) => n + (c.emails?.length || (c.email ? 1 : 0)), 0);
      let text = `Added ${emailCount} email(s) across ${groupCount} company application(s). Cover letters are generating…`;
      if (res.message) text += ` ${res.message}`;
      setBanner({ kind: 'info', text });
      await refresh();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleSendSelected = async () => {
    const ids = [...selected].filter((id) => sendableEmailIds.includes(id));
    if (ids.length === 0) {
      setBanner({ kind: 'error', text: 'Select at least one email that is ready to send.' });
      return;
    }
    if (!resume) {
      setBanner({ kind: 'error', text: 'Upload a resume before sending.' });
      return;
    }
    if (!confirm(`Send ${ids.length} email(s) now? (same cover letter, personalized greeting per HR)`))
      return;

    setBusy(true);
    setBanner(null);
    try {
      const { results } = await api.sendApplications(ids);
      const sent = results.filter((r) => r.ok && !r.skipped).length;
      const failed = results.filter((r) => !r.ok).length;
      setBanner({
        kind: failed ? 'error' : 'success',
        text: `Sent: ${sent}. Failed: ${failed}.`,
      });
      clearSelection();
      await refresh();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveReview = async (form) => {
    if (!reviewTarget) return;
    try {
      await api.updateApplication(reviewTarget.id, {
        company: form.company,
        role: form.role,
        subject: form.subject,
        coverLetter: form.coverLetter,
        body: form.body,
        clearBody: form.clearBody,
        recipients: form.recipients,
      });
      await api.markReviewed(reviewTarget.id);
      await refresh();
      setReviewId(null);
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  const handleRegenerate = async (groupId) => {
    try {
      await api.regenerate(groupId);
      await refresh();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  const handleDeleteGroup = async (groupId) => {
    if (!confirm('Delete this company application and all its HR contacts?')) return;
    try {
      await api.deleteApplication(groupId);
      setSelected((prev) => {
        const group = applications.find((g) => g.id === groupId);
        const next = new Set(prev);
        for (const r of group?.recipients || []) {
          for (const e of getRecipientEmails(r)) next.delete(e.id);
        }
        return next;
      });
      await refresh();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  const handleDeleteRecipient = async (groupId, recipientId) => {
    if (!confirm('Remove this HR contact?')) return;
    try {
      await api.deleteRecipient(groupId, recipientId);
      setSelected((prev) => {
        const group = applications.find((g) => g.id === groupId);
        const next = new Set(prev);
        const r = group?.recipients?.find((x) => x.id === recipientId);
        for (const e of getRecipientEmails(r)) next.delete(e.id);
        return next;
      });
      await refresh();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  const handleDeleteEmail = async (groupId, recipientId, emailId) => {
    if (!confirm('Remove this email address?')) return;
    try {
      await api.deleteEmail(groupId, recipientId, emailId);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(emailId);
        return next;
      });
      await refresh();
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  };

  const counts = useMemo(() => {
    const c = { pending: 0, reviewed: 0, sent: 0, failed: 0 };
    for (const g of applications) {
      for (const r of g.recipients || []) {
        for (const e of getRecipientEmails(r)) {
          if (e.status === 'sent') c.sent++;
          else if (e.status === 'failed') c.failed++;
          else if (g.status === 'reviewed') c.reviewed++;
          else c.pending++;
        }
      }
    }
    return c;
  }, [applications]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">✉︎</span>
          <div>
            <h1>ApplyMate</h1>
            <p className="tagline">Generate, review, and send job application emails</p>
          </div>
        </div>
        <div className="health">
          <HealthDot ok={health?.openaiConfigured} label="OpenAI" />
          <HealthDot ok={health?.smtpConfigured} label="SMTP" />
        </div>
      </header>

      {banner && (
        <div className={`banner banner-${banner.kind}`}>
          <span>{banner.text}</span>
          <button className="link" onClick={() => setBanner(null)}>
            dismiss
          </button>
        </div>
      )}

      <main className="content">
        <section className="grid">
          <ResumeCard
            resume={resume}
            onUpload={async (file) => {
              setBusy(true);
              try {
                const { resume } = await api.uploadResume(file);
                setResume(resume);
                setBanner({ kind: 'success', text: 'Resume uploaded.' });
              } catch (err) {
                setBanner({ kind: 'error', text: err.message });
              } finally {
                setBusy(false);
              }
            }}
            onDelete={async () => {
              if (!confirm('Remove the saved resume?')) return;
              await api.deleteResume();
              setResume(null);
            }}
          />

          <div className="card stats-card">
            <h3>Pipeline</h3>
            <div className="stats">
              <Stat label="Pending" value={counts.pending} kind="pending" />
              <Stat label="Reviewed" value={counts.reviewed} kind="reviewed" />
              <Stat label="Sent" value={counts.sent} kind="sent" />
              <Stat label="Failed" value={counts.failed} kind="failed" />
            </div>
            <p className="hint">
              Workflow: <strong>Generate → Review/Edit → Approve → Send</strong>. Multiple HRs and
              multiple emails per HR share one AI-generated cover letter per company + role.
            </p>
          </div>
        </section>

        <section className="actions">
          <button className="btn primary" onClick={() => setShowBulk(true)}>
            + Add companies
          </button>
          <button className="btn" onClick={selectAll} disabled={!sendableEmailIds.length}>
            Select all ready
          </button>
          <button className="btn" onClick={clearSelection} disabled={!selected.size}>
            Clear selection
          </button>
          <div className="spacer" />
          <button
            className="btn success"
            disabled={!selected.size || busy}
            onClick={handleSendSelected}
          >
            Send selected ({selected.size})
          </button>
        </section>

        <ApplicationsTable
          applications={applications}
          selected={selected}
          onToggleSelect={toggleSelect}
          onReview={(groupId) => setReviewId(groupId)}
          onRegenerate={handleRegenerate}
          onDeleteGroup={handleDeleteGroup}
          onDeleteRecipient={handleDeleteRecipient}
          onDeleteEmail={handleDeleteEmail}
        />
      </main>

      {showBulk && (
        <BulkAddForm busy={busy} onClose={() => setShowBulk(false)} onSubmit={handleBulkAdd} />
      )}

      {reviewTarget && (
        <ReviewModal
          application={reviewTarget}
          applicant={health?.applicant}
          onClose={() => setReviewId(null)}
          onSave={handleSaveReview}
          onRegenerate={() => handleRegenerate(reviewTarget.id)}
          onRevalidateEmail={async (groupId, recipientId, emailId) => {
            await api.validateEmail(groupId, recipientId, emailId);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function HealthDot({ ok, label }) {
  return (
    <span
      className={`pill ${ok ? 'pill-ok' : 'pill-warn'}`}
      title={ok ? 'Configured' : 'Not configured'}
    >
      <span className="dot" />
      {label}
    </span>
  );
}

function Stat({ label, value, kind }) {
  return (
    <div className={`stat stat-${kind}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
