import { useEffect, useMemo, useState } from 'react';
import { getRecipientEmails } from '../api.js';
import { buildPreviewBody } from '../utils/emailPreview.js';
import EmailValidationBadge from './EmailValidationBadge.jsx';

export default function ReviewModal({
  application,
  applicant,
  onClose,
  onSave,
  onRegenerate,
  onRevalidateEmail,
}) {
  const [form, setForm] = useState(() => buildFormState(application));
  const [useCustomBody, setUseCustomBody] = useState(Boolean(application.body?.trim()));

  useEffect(() => {
    setForm(buildFormState(application));
    setUseCustomBody(Boolean(application.body?.trim()));
  }, [application]);

  const previewRecipient = form.recipients[0];
  const autoBody = useMemo(
    () =>
      buildPreviewBody({
        hrName: previewRecipient?.hrName,
        company: form.company,
        coverLetter: form.coverLetter,
        applicantName: applicant?.name,
        applicantPhone: applicant?.phone,
      }),
    [
      form.coverLetter,
      form.company,
      previewRecipient?.hrName,
      applicant?.name,
      applicant?.phone,
    ],
  );

  const displayBody = useCustomBody ? form.body : autoBody;

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const updateRecipient = (recipientId, key, value) => {
    setForm((f) => ({
      ...f,
      recipients: f.recipients.map((r) =>
        r.id === recipientId ? { ...r, [key]: value } : r,
      ),
    }));
  };

  const updateEmail = (recipientId, emailId, address) => {
    setForm((f) => ({
      ...f,
      recipients: f.recipients.map((r) =>
        r.id === recipientId
          ? {
              ...r,
              emails: r.emails.map((e) =>
                e.id === emailId ? { ...e, address } : e,
              ),
            }
          : r,
      ),
    }));
  };

  const addEmail = (recipientId) => {
    setForm((f) => ({
      ...f,
      recipients: f.recipients.map((r) =>
        r.id === recipientId
          ? { ...r, emails: [...r.emails, { id: `new-${crypto.randomUUID()}`, address: '' }] }
          : r,
      ),
    }));
  };

  const removeEmail = (recipientId, emailId) => {
    setForm((f) => ({
      ...f,
      recipients: f.recipients
        .map((r) =>
          r.id === recipientId
            ? { ...r, emails: r.emails.filter((e) => e.id !== emailId) }
            : r,
        )
        .filter((r) => r.emails.length > 0),
    }));
  };

  const handleSave = () => {
    onSave({
      company: form.company.trim(),
      role: form.role.trim(),
      subject: form.subject.trim(),
      coverLetter: form.coverLetter.trim(),
      body: useCustomBody ? form.body.trim() : '',
      clearBody: !useCustomBody,
      recipients: form.recipients.map((r) => ({
        id: r.id,
        hrName: r.hrName.trim(),
        emails: r.emails.map((e) => ({
          ...(e.id && !String(e.id).startsWith('new-') ? { id: e.id } : {}),
          address: e.address.trim(),
        })),
      })),
    });
  };

  const isGenerating =
    application.status === 'pending' && !application.coverLetter && !application.error;

  const validationByEmailId = useMemo(() => {
    const map = {};
    for (const r of application.recipients || []) {
      for (const e of getRecipientEmails(r)) {
        map[e.id] = e;
      }
    }
    return map;
  }, [application.recipients]);

  const hasInvalidEmail = Object.values(validationByEmailId).some(
    (e) => e.emailValidation === 'invalid',
  );

  const allEmailsFilled = form.recipients.every((r) =>
    r.emails.every((e) => e.address.trim()),
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal review-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Review & edit</h2>
            <p className="muted small">
              Update company details, HR contacts, and the cover letter before sending.
            </p>
          </div>
          <button className="btn ghost" onClick={onRegenerate} disabled={isGenerating}>
            ↻ Regenerate letter
          </button>
        </header>

        <div className="modal-body review-body">
          {isGenerating && (
            <div className="banner banner-info inline">
              Cover letter is still generating. You can edit company and HR details now; save once
              the letter appears.
            </div>
          )}

          {hasInvalidEmail && (
            <div className="banner banner-error inline">
              One or more emails failed validation. Fix or re-check before sending.
            </div>
          )}

          <section className="review-section">
            <h3 className="review-section-title">Company</h3>
            <div className="form-row two">
              <label>
                <span>Company name</span>
                <input value={form.company} onChange={update('company')} />
              </label>
              <label>
                <span>Role / title</span>
                <input value={form.role} onChange={update('role')} />
              </label>
            </div>
          </section>

          <section className="review-section">
            <h3 className="review-section-title">HR contacts</h3>
            <p className="hint section-hint">
              Each person can have multiple email addresses. Every address is validated and sent
              separately with the same cover letter and a personalized greeting.
            </p>
            {form.recipients.map((r) => (
              <div className="recipient-row review-recipient" key={r.id}>
                <label className="recipient-field">
                  <span>Name</span>
                  <input
                    placeholder="HR name"
                    value={r.hrName}
                    onChange={(e) => updateRecipient(r.id, 'hrName', e.target.value)}
                  />
                </label>
                <div className="recipient-emails-block">
                  <span className="section-label">Emails</span>
                  {r.emails.map((e) => {
                    const live = e.id ? validationByEmailId[e.id] : null;
                    return (
                      <div className="email-line" key={e.id || `new-${e.address}`}>
                        <div className="email-field-col">
                          <input
                            placeholder="email@company.com"
                            value={e.address}
                            onChange={(ev) => updateEmail(r.id, e.id, ev.target.value)}
                          />
                          <div className="email-field-meta">
                            {live && (
                              <EmailValidationBadge
                                status={live.emailValidation}
                                message={live.emailValidationMessage}
                              />
                            )}
                            {onRevalidateEmail && e.id && (
                              <button
                                type="button"
                                className="btn small ghost"
                                disabled={live?.emailValidation === 'checking'}
                                onClick={() =>
                                  onRevalidateEmail(application.id, r.id, e.id)
                                }
                              >
                                Re-check
                              </button>
                            )}
                          </div>
                        </div>
                        {r.emails.length > 1 && (
                          <button
                            type="button"
                            className="btn danger-ghost"
                            onClick={() => removeEmail(r.id, e.id)}
                            title="Remove email"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => addEmail(r.id)}
                  >
                    + Add email
                  </button>
                </div>
              </div>
            ))}
          </section>

          <section className="review-section">
            <h3 className="review-section-title">Email content</h3>
            <label className="form-row">
              <span>Subject</span>
              <input value={form.subject} onChange={update('subject')} />
            </label>

            <label className="form-row">
              <span>Cover letter (saved and used in every outgoing email)</span>
              <textarea
                rows={8}
                value={form.coverLetter}
                onChange={update('coverLetter')}
                disabled={isGenerating}
              />
            </label>

            <label className="form-row checkbox-row">
              <input
                type="checkbox"
                checked={useCustomBody}
                onChange={(e) => {
                  setUseCustomBody(e.target.checked);
                  if (!e.target.checked) {
                    setForm((f) => ({ ...f, body: '' }));
                  }
                }}
              />
              <span>Edit the complete email text manually (disables auto-build from cover letter)</span>
            </label>

            <label className="form-row">
              <span>
                {useCustomBody
                  ? 'Full email body (exact text sent to every recipient)'
                  : `Preview — first recipient (${previewRecipient?.hrName || 'Team'})`}
              </span>
              <textarea
                rows={12}
                value={useCustomBody ? form.body : displayBody}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                readOnly={!useCustomBody}
                className={useCustomBody ? '' : 'readonly'}
              />
            </label>

            {!useCustomBody && form.recipients.length > 1 && (
              <p className="hint">
                Other recipients get the same cover letter with their own name in the greeting.
              </p>
            )}
          </section>
        </div>

        <footer className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={
              !form.company.trim() ||
              !form.role.trim() ||
              !form.subject.trim() ||
              !form.coverLetter.trim() ||
              !allEmailsFilled ||
              form.recipients.length === 0
            }
          >
            Save & mark reviewed
          </button>
        </footer>
      </div>
    </div>
  );
}

function buildFormState(application) {
  const rs = application.recipients || [];
  return {
    company: application.company,
    role: application.role,
    subject: application.subject,
    coverLetter: application.coverLetter,
    body: application.body || '',
    recipients: rs.map((r) => ({
      id: r.id,
      hrName: r.hrName,
      emails: getRecipientEmails(r).map((e) => ({ id: e.id, address: e.address })),
    })),
  };
}
