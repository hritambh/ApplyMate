import { useEffect, useState } from 'react';
import { api, isUnauthorized } from '../api.js';

const EMPTY = {
  applicantName: '',
  applicantHeadline: '',
  applicantSkills: '',
  applicantPhone: '',
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: '',
  smtpPass: '',
  mailFromName: '',
  mailFromAddress: '',
  openaiKey: '',
  linkedinUrl: '',
};

export default function ProfileSetup({
  initialProfile,
  onComplete,
  onCancel,
  banner,
  setBanner,
  required = true,
}) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [subBusy, setSubBusy] = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [subMessage, setSubMessage] = useState('');

  useEffect(() => {
    if (initialProfile) {
      setForm({
        applicantName: initialProfile.applicantName || '',
        applicantHeadline: initialProfile.applicantHeadline || '',
        applicantSkills: initialProfile.applicantSkills || '',
        applicantPhone: initialProfile.applicantPhone || '',
        smtpHost: initialProfile.smtpHost || 'smtp.gmail.com',
        smtpPort: initialProfile.smtpPort || 465,
        smtpSecure: initialProfile.smtpSecure ?? true,
        smtpUser: initialProfile.smtpUser || '',
        smtpPass: '',
        mailFromName: initialProfile.mailFromName || '',
        mailFromAddress: initialProfile.mailFromAddress || '',
        openaiKey: '',
        linkedinUrl: initialProfile.linkedinUrl || '',
      });
    }

    // Load subscription status
    api.getMySubscription().then((res) => setSubscription(res.subscription)).catch(() => {});
  }, [initialProfile]);

  const setField = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setBanner?.(null);
    setBusy(true);
    try {
      const res = await api.updateProfile(form);
      if (res.complete) {
        onComplete(res.profile);
      } else {
        setBanner?.({ kind: 'error', text: 'Please fill in all required fields.' });
      }
    } catch (err) {
      if (!isUnauthorized(err)) setBanner?.({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleTestSmtp = async () => {
    setBanner?.(null);
    setTesting(true);
    try {
      await api.updateProfile(form);
      const res = await api.testSmtp();
      setBanner?.({ kind: 'success', text: res.message || 'Test email sent.' });
    } catch (err) {
      if (!isUnauthorized(err)) setBanner?.({ kind: 'error', text: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleRequestAccess = async () => {
    setSubBusy(true);
    try {
      const res = await api.requestSubscription(subMessage);
      setSubscription(res.subscription);
      setSubMessage('');
      setBanner?.({ kind: 'success', text: 'Access request submitted. The admin will review it.' });
    } catch (err) {
      setBanner?.({ kind: 'error', text: err.message });
    } finally {
      setSubBusy(false);
    }
  };

  const openaiConfigured = initialProfile?.openaiKeyConfigured;
  const openaiSource = initialProfile?.openaiSource;
  const subStatus = subscription?.status ?? initialProfile?.subscriptionStatus;

  return (
    <div className="auth-page">
      <div className="profile-card">
        <h1 className="auth-title">
          {required ? 'Complete your profile' : 'Profile settings'}
        </h1>
        <p className="auth-subtitle">
          {required
            ? 'ApplyMate needs your details to generate cover letters and send emails from your account.'
            : 'Update your applicant info and email settings.'}
        </p>

        {banner && (
          <div className={`banner banner-${banner.kind} auth-banner`}>{banner.text}</div>
        )}

        <form className="profile-form" onSubmit={handleSave}>
          <fieldset className="profile-section">
            <legend>About you (cover letters)</legend>
            <label className="auth-field">
              <span>Full name</span>
              <input value={form.applicantName} onChange={setField('applicantName')} disabled={busy} />
            </label>
            <label className="auth-field">
              <span>Professional headline</span>
              <input
                value={form.applicantHeadline}
                onChange={setField('applicantHeadline')}
                placeholder="Backend Engineer with 4 years in Node.js"
                disabled={busy}
              />
            </label>
            <label className="auth-field">
              <span>Skills</span>
              <textarea
                rows={3}
                value={form.applicantSkills}
                onChange={setField('applicantSkills')}
                placeholder="Node.js, React, AWS, …"
                disabled={busy}
              />
            </label>
            <label className="auth-field">
              <span>Phone</span>
              <input
                value={form.applicantPhone}
                onChange={setField('applicantPhone')}
                placeholder="8757518503"
                disabled={busy}
              />
            </label>
            <label className="auth-field">
              <span>LinkedIn URL</span>
              <input
                type="url"
                value={form.linkedinUrl}
                onChange={setField('linkedinUrl')}
                placeholder="https://linkedin.com/in/your-profile"
                disabled={busy}
              />
            </label>
          </fieldset>

          <fieldset className="profile-section">
            <legend>OpenAI API key</legend>
            <p className="profile-hint">
              Provide your own{' '}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                OpenAI API key
              </a>{' '}
              to generate cover letters, or request shared access below.
            </p>

            {/* Current status pill */}
            {openaiConfigured && (
              <div className="profile-hint" style={{ color: '#16a34a', marginBottom: 8 }}>
                Your own key is configured.{' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    if (confirm('Remove your stored OpenAI key?')) {
                      api.updateProfile({ ...form, clearOpenaiKey: true })
                        .then((r) => onComplete?.(r.profile))
                        .catch((err) => setBanner?.({ kind: 'error', text: err.message }));
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            )}
            {!openaiConfigured && openaiSource === 'shared' && (
              <div className="profile-hint" style={{ color: '#16a34a', marginBottom: 8 }}>
                Shared access approved — you are using the server key.
              </div>
            )}

            <label className="auth-field">
              <span>{openaiConfigured ? 'Replace key (leave blank to keep current)' : 'API key'}</span>
              <input
                type="password"
                value={form.openaiKey}
                onChange={setField('openaiKey')}
                placeholder="sk-…"
                autoComplete="off"
                disabled={busy}
              />
            </label>

            {/* Shared access request section */}
            {!openaiConfigured && openaiSource !== 'shared' && (
              <div className="profile-hint" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
                <strong>Or request shared access from the admin</strong>
                {subStatus === 'pending' && (
                  <p style={{ color: '#d97706', margin: '6px 0 0' }}>
                    Request pending — the admin will review soon.
                  </p>
                )}
                {subStatus === 'denied' && (
                  <p style={{ color: '#ef4444', margin: '6px 0 0' }}>
                    Request denied{subscription?.reviewNote ? `: ${subscription.reviewNote}` : '.'} You can re-submit below.
                  </p>
                )}
                {subStatus !== 'pending' && (
                  <>
                    <textarea
                      rows={2}
                      className="auth-field"
                      style={{ display: 'block', width: '100%', marginTop: 8 }}
                      placeholder="Optional: explain your use case…"
                      value={subMessage}
                      onChange={(e) => setSubMessage(e.target.value)}
                      disabled={subBusy}
                    />
                    <button
                      type="button"
                      className="btn small"
                      style={{ marginTop: 6 }}
                      onClick={handleRequestAccess}
                      disabled={subBusy}
                    >
                      {subBusy ? 'Submitting…' : subStatus === 'denied' ? 'Re-submit request' : 'Request shared access'}
                    </button>
                  </>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="profile-section">
            <legend>Email (SMTP)</legend>
            <p className="profile-hint">
              For Gmail, use an{' '}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
                App Password
              </a>
              , port 465, and secure = on.
            </p>
            <div className="profile-row">
              <label className="auth-field flex-2">
                <span>SMTP host</span>
                <input value={form.smtpHost} onChange={setField('smtpHost')} disabled={busy} />
              </label>
              <label className="auth-field flex-1">
                <span>Port</span>
                <input type="number" value={form.smtpPort} onChange={setField('smtpPort')} disabled={busy} />
              </label>
            </div>
            <label className="auth-field checkbox-inline">
              <input type="checkbox" checked={form.smtpSecure} onChange={setField('smtpSecure')} disabled={busy} />
              <span>Use SSL/TLS (secure)</span>
            </label>
            <label className="auth-field">
              <span>SMTP user (email)</span>
              <input type="email" value={form.smtpUser} onChange={setField('smtpUser')} disabled={busy} />
            </label>
            <label className="auth-field">
              <span>
                SMTP app password
                {initialProfile?.smtpPassConfigured && ' (leave blank to keep current)'}
              </span>
              <input
                type="password"
                value={form.smtpPass}
                onChange={setField('smtpPass')}
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
            <label className="auth-field">
              <span>From name</span>
              <input value={form.mailFromName} onChange={setField('mailFromName')} disabled={busy} />
            </label>
            <label className="auth-field">
              <span>From address</span>
              <input type="email" value={form.mailFromAddress} onChange={setField('mailFromAddress')} disabled={busy} />
            </label>
          </fieldset>

          <div className="profile-actions">
            {!required && onCancel && (
              <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
            )}
            <button type="button" className="btn ghost" onClick={handleTestSmtp} disabled={busy || testing}>
              {testing ? 'Sending test…' : 'Send test email'}
            </button>
            <button type="submit" className="btn primary auth-submit" disabled={busy}>
              {busy ? 'Saving…' : required ? 'Save & continue' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
