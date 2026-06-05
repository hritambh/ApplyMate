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
import AdminPanel from './components/AdminPanel.jsx';
import HistoryModal from './components/HistoryModal.jsx';

export default function App() {
  // --- Auth State ---
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('applymate_token'));

  // --- Profile State ---
  const [profile, setProfile] = useState(null);
  const [profileComplete, setProfileComplete] = useState(false);
  const [userRole, setUserRole] = useState(() => localStorage.getItem('applymate_role') || 'user');
  const [profileLoading, setProfileLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  // --- Dashboard State ---
  const [health, setHealth] = useState(null);
  const [resume, setResume] = useState(null);
  const [applications, setApplications] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [selectedFollowUps, setSelectedFollowUps] = useState(() => new Set());
  const [showBulk, setShowBulk] = useState(false);
  const [reviewId, setReviewId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('applymate_token');
    localStorage.removeItem('applymate_role');
    setIsAuthenticated(false);
    setProfile(null);
    setProfileComplete(false);
    setShowSettings(false);
    setShowAdmin(false);
    setPendingApprovals(0);
    setApplications([]);
    setResume(null);
    setUserRole('user');
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

  const handleAuthSuccess = (token, role = 'user') => {
    localStorage.setItem('applymate_token', token);
    localStorage.setItem('applymate_role', role);
    setUserRole(role);
    setIsAuthenticated(true);
    setBanner(null);
  };

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const res = await api.getProfile();
      setProfile(res.profile);
      setProfileComplete(Boolean(res.complete));
      if (res.profile?.role) {
        setUserRole(res.profile.role);
        localStorage.setItem('applymate_role', res.profile.role);
      }
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

  const refreshPendingApprovals = useCallback(async () => {
    if (userRole !== 'su') return;
    try {
      const res = await api.listSubscriptions();
      setPendingApprovals((res.subscriptions || []).filter((s) => s.status === 'pending').length);
    } catch {
      // Non-critical: leave the badge as-is on failure
    }
  }, [userRole]);

  // Load profile when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadProfile();
    }
  }, [isAuthenticated, loadProfile]);

  // Keep the top-bar approvals badge in sync for superusers
  useEffect(() => {
    if (isAuthenticated && profileComplete && userRole === 'su') {
      refreshPendingApprovals();
    }
  }, [isAuthenticated, profileComplete, userRole, refreshPendingApprovals]);

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
        onBackToSignIn={!profileComplete ? handleLogout : undefined}
        banner={banner}
        setBanner={setBanner}
      />
    );
  }

  if (userRole === 'su' && showAdmin) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="logo">✉︎</span>
            <div>
              <h1>Approvals</h1>
              <p className="tagline">Review OpenAI shared-access requests</p>
            </div>
          </div>
          <div className="health">
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                setShowAdmin(false);
                refreshPendingApprovals();
              }}
            >
              ← Back to dashboard
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
          <AdminPanel
            onError={(msg) => setBanner({ kind: 'error', text: msg })}
            onPendingChange={setPendingApprovals}
          />
        </main>
      </div>
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
          <HealthDot
            ok={profile?.openaiKeyConfigured || profile?.openaiSource === 'shared'}
            label={userRole === 'su' ? 'OpenAI (SU)' : 'OpenAI'}
            title={
              profile?.openaiKeyConfigured
                ? 'Using your own OpenAI key'
                : profile?.openaiSource === 'shared'
                  ? 'Using shared server key (approved)'
                  : 'No OpenAI key — add one in Settings'
            }
          />
          <HealthDot ok={profile?.smtpPassConfigured && profile?.smtpHost} label="SMTP" />
          <HealthDot ok={profileComplete} label="Profile" />
          {userRole === 'su' && (
            <span className="pill pill-ok" title="Superuser">
              <span className="dot" /> SU
            </span>
          )}
          {userRole === 'su' && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setShowAdmin(true)}
              title={
                pendingApprovals > 0
                  ? `${pendingApprovals} pending approval${pendingApprovals > 1 ? 's' : ''}`
                  : 'No pending approvals'
              }
              style={{ marginLeft: 8, position: 'relative' }}
            >
              Approvals
              {pendingApprovals > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    background: '#ef4444',
                    color: 'white',
                    borderRadius: 9,
                    fontSize: 11,
                    lineHeight: '18px',
                    fontWeight: 700,
                    textAlign: 'center',
                    boxShadow: '0 0 0 2px #fff',
                  }}
                >
                  {pendingApprovals}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setShowSettings(true)}
            style={{ marginLeft: 8 }}
          >
            Settings
          </button>
          {true && (
            <a
              href={profile?.linkedinUrl || 'https://www.linkedin.com/feed/'}
              target="_blank"
              rel="noreferrer"
              title="Open LinkedIn profile"
              style={{
                marginLeft: '8px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                background: '#0a66c2',
                borderRadius: '6px',
                color: 'white',
                textDecoration: 'none',
                flexShrink: 0,
              }}
            >
              <LinkedInIcon />
            </a>
          )}
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
          <button className="btn" onClick={() => setShowHistory(true)}>
            History
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

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} />}

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

function LinkedInIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}

function HealthDot({ ok, label, title }) {
  return (
    <span
      className={`pill ${ok ? 'pill-ok' : 'pill-warn'}`}
      title={title ?? (ok ? 'Configured' : 'Not configured')}
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