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
      });
    }
  }, [initialProfile]);

  const setField = (key) => (e) => {
    const value =
      e.target.type === 'checkbox' ? e.target.checked : e.target.value;
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
      if (!isUnauthorized(err)) {
        setBanner?.({ kind: 'error', text: err.message });
      }
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
      if (!isUnauthorized(err)) {
        setBanner?.({ kind: 'error', text: err.message });
      }
    } finally {
      setTesting(false);
    }
  };

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
                <input
                  type="number"
                  value={form.smtpPort}
                  onChange={setField('smtpPort')}
                  disabled={busy}
                />
              </label>
            </div>
            <label className="auth-field checkbox-inline">
              <input
                type="checkbox"
                checked={form.smtpSecure}
                onChange={setField('smtpSecure')}
                disabled={busy}
              />
              <span>Use SSL/TLS (secure)</span>
            </label>
            <label className="auth-field">
              <span>SMTP user (email)</span>
              <input
                type="email"
                value={form.smtpUser}
                onChange={setField('smtpUser')}
                disabled={busy}
              />
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
              <input
                type="email"
                value={form.mailFromAddress}
                onChange={setField('mailFromAddress')}
                disabled={busy}
              />
            </label>
          </fieldset>

          <div className="profile-actions">
            {!required && onCancel && (
              <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              onClick={handleTestSmtp}
              disabled={busy || testing}
            >
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
