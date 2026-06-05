import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  getRecipientEmails,
  isEmailChecking,
  isEmailFollowUpable,
  isEmailSendable,
  isGroupGenerating,
  isUnauthorized,
  onApiError,
} from './api.js';
import ResumeCard from './components/ResumeCard.jsx';
import BulkAddForm from './components/BulkAddForm.jsx';
import ApplicationsTable from './components/ApplicationsTable.jsx';
import ReviewModal from './components/ReviewModal.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import ProfileSetup from './components/ProfileSetup.jsx';

export default function App() {
  // --- Auth State ---
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('applymate_token'));

  // --- Profile State ---
  const [profile, setProfile] = useState(null);
  const [profileComplete, setProfileComplete] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // --- Dashboard State ---
  const [health, setHealth] = useState(null);
  const [resume, setResume] = useState(null);
  const [applications, setApplications] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [selectedFollowUps, setSelectedFollowUps] = useState(() => new Set());
  const [showBulk, setShowBulk] = useState(false);
  const [reviewId, setReviewId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('applymate_token');
    setIsAuthenticated(false);
    setProfile(null);
    setProfileComplete(false);
    setShowSettings(false);
    setApplications([]);
    setResume(null);
  }, []);

  const handleSessionExpired = useCallback(
    (message = 'Session expired. Please sign in again.') => {
      handleLogout();
      setBanner({ kind: 'error', text: message });
    },
    [handleLogout],
  );

  // Global API error interceptor — logs in api.js, shows banner here
  useEffect(() => {
    return onApiError((err) => {
      if (isUnauthorized(err)) {
        handleSessionExpired(err.message);
        return;
      }
      setBanner({ kind: 'error', text: err.message });
    });
  }, [handleSessionExpired]);

  // Intercept Google OAuth token or error from the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const authError = params.get('auth_error');

    if (authError) {
      console.error('[oauth] Sign-in failed:', authError);
      setBanner({ kind: 'error', text: `Google sign-in failed: ${authError}` });
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (token) {
      localStorage.setItem('applymate_token', token);
      setIsAuthenticated(true);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleAuthSuccess = (token) => {
    localStorage.setItem('applymate_token', token);
    setIsAuthenticated(true);
    setBanner(null);
  };

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const res = await api.getProfile();
      setProfile(res.profile);
      setProfileComplete(Boolean(res.complete));
      return res;
    } catch (err) {
      if (isUnauthorized(err)) {
        handleSessionExpired(err.message);
      } else {
        setBanner({ kind: 'error', text: err.message });
      }
      return null;
    } finally {
      setProfileLoading(false);
    }
  }, [handleSessionExpired]);

  const handleProfileComplete = (updatedProfile) => {
    setProfile(updatedProfile);
    setProfileComplete(Boolean(updatedProfile?.complete));
    setShowSettings(false);
    setBanner(null);
  };

  const refresh = useCallback(async () => {
    const [healthRes, resumeRes, appsRes] = await Promise.allSettled([
      api.health(),
      api.getResume(),
      api.listApplications(),
    ]);

    if (healthRes.status === 'fulfilled') {
      setHealth(healthRes.value);
    }

    if (resumeRes.status === 'fulfilled') {
      setResume(resumeRes.value.resume ?? null);
    }

    if (appsRes.status === 'fulfilled') {
      setApplications(appsRes.value.applications ?? []);
    } else {
      const err = appsRes.reason;
      if (isUnauthorized(err)) {
        handleSessionExpired(err.message);
      } else {
        setBanner({ kind: 'error', text: err?.message || 'Failed to load applications' });
      }
      return;
    }

    const failed = [healthRes, resumeRes].filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      const message = failed[0].reason?.message;
      if (message && !isUnauthorized(failed[0].reason)) {
        console.warn('Partial refresh failure:', message);
      }
    }
  }, [handleSessionExpired]);

  // Load profile when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadProfile();
    }
  }, [isAuthenticated, loadProfile]);

  // Only fetch dashboard data when profile is complete
  useEffect(() => {
    if (isAuthenticated && profileComplete && !showSettings) {
      refresh();
    }
  }, [refresh, isAuthenticated, profileComplete, showSettings]);

  useEffect(() => {
    if (!isAuthenticated || !profileComplete || showSettings) return;

    const isBusy =
      applications.some((g) => isGroupGenerating(g)) || isEmailChecking(applications);
    if (!isBusy) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [applications, refresh, isAuthenticated, profileComplete, showSettings]);

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

  const toggleSelectFollowUp = (emailId) => {
    setSelectedFollowUps((prev) => {
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

  const followUpableEmailIds = useMemo(() => {
    const ids = [];
    for (const g of applications) {
      for (const r of g.recipients || []) {
        for (const e of getRecipientEmails(r)) {
          if (isEmailFollowUpable(e)) ids.push(e.id);
        }
      }
    }
    return ids;
  }, [applications]);

  const selectAll = () => setSelected(new Set(sendableEmailIds));
  const clearSelection = () => {
    setSelected(new Set());
    setSelectedFollowUps(new Set());
  };

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

  const handleSendFollowUps = async () => {
    const ids = [...selectedFollowUps].filter((id) => followUpableEmailIds.includes(id));
    if (ids.length === 0) {
      setBanner({ kind: 'error', text: 'Select at least one sent email to follow up on.' });
      return;
    }
    if (!confirm(`Send ${ids.length} follow-up email(s)? They will be sent as replies in the same thread.`))
      return;

    setBusy(true);
    setBanner(null);
    try {
      const { results } = await api.sendFollowUps(ids);
      const sent = results.filter((r) => r.ok && !r.skipped).length;
      const failed = results.filter((r) => !r.ok).length;
      setBanner({
        kind: failed ? 'error' : 'success',
        text: `Follow-ups sent: ${sent}. Failed: ${failed}.`,
      });
      setSelectedFollowUps(new Set());
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
      setBanner({ kind: 'success', text: `Application for ${reviewTarget.company} marked as reviewed.` });
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

  if (!isAuthenticated) {
    return (
      <AuthScreen
        onAuthSuccess={handleAuthSuccess}
        banner={banner}
        setBanner={setBanner}
      />
    );
  }

  if (profileLoading && !profile) {
    return (
      <div className="auth-page">
        <p className="auth-subtitle">Loading profile…</p>
      </div>
    );
  }

  if (!profileComplete || showSettings) {
    return (
      <ProfileSetup
        initialProfile={profile}
        required={!profileComplete}
        onComplete={handleProfileComplete}
        onCancel={profileComplete ? () => setShowSettings(false) : undefined}
        banner={banner}
        setBanner={setBanner}
      />
    );
  }

  const applicant = {
    name: profile?.applicantName || '',
    phone: profile?.applicantPhone || '',
  };

  // --- Render Dashboard ---
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
          <HealthDot ok={profile?.smtpPassConfigured && profile?.smtpHost} label="SMTP" />
          <HealthDot ok={profileComplete} label="Profile" />
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setShowSettings(true)}
            style={{ marginLeft: 8 }}
          >
            Settings
          </button>
          <button
            onClick={handleLogout}
            style={{
              marginLeft: '8px',
              padding: '6px 12px',
              background: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            Logout
          </button>
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
          <button className="btn" onClick={clearSelection} disabled={!selected.size && !selectedFollowUps.size}>
            Clear selection
          </button>
          <div className="spacer" />
          {selectedFollowUps.size > 0 && (
            <button
              className="btn"
              disabled={busy}
              onClick={handleSendFollowUps}
              style={{ background: '#7c3aed', color: 'white' }}
            >
              Send follow-ups ({selectedFollowUps.size})
            </button>
          )}
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
          selectedFollowUps={selectedFollowUps}
          onToggleSelect={toggleSelect}
          onToggleFollowUp={toggleSelectFollowUp}
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
          applicant={applicant}
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