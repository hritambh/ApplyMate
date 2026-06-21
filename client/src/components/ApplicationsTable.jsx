import { useEffect, useRef } from 'react';
import {
  countGroupEmails,
  countGroupEmailsByStatus,
  followUpCount,
  getRecipientEmails,
  isEmailFollowUpable,
  isEmailSendable,
  isGroupGenerating,
} from '../api.js';
import EmailValidationBadge from './EmailValidationBadge.jsx';

export default function ApplicationsTable({
  applications,
  selected,
  selectedFollowUps,
  onToggleSelect,
  onToggleSelectGroup,
  onToggleFollowUp,
  onReview,
  onRegenerate,
  onDeleteGroup,
  onDeleteRecipient,
  onDeleteEmail,
  emptyMessage,
}) {
  if (applications.length === 0) {
    return (
      <div className="empty">
        <p>
          {emptyMessage || (
            <>No applications yet. Click <strong>Add companies</strong> to get started.</>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="apps-table">
        <thead>
          <tr>
            <th className="col-check"></th>
            <th>Company</th>
            <th>Role</th>
            <th>Recipients</th>
            <th>Status</th>
            <th className="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {applications.map((group) => (
            <GroupRows
              key={group.id}
              group={group}
              isGenerating={isGroupGenerating(group)}
              emailCount={countGroupEmails(group)}
              sentCount={countGroupEmailsByStatus(group, 'sent')}
              selected={selected}
              selectedFollowUps={selectedFollowUps}
              onToggleSelect={onToggleSelect}
              onToggleSelectGroup={onToggleSelectGroup}
              onToggleFollowUp={onToggleFollowUp}
              onReview={onReview}
              onRegenerate={onRegenerate}
              onDeleteGroup={onDeleteGroup}
              onDeleteRecipient={onDeleteRecipient}
              onDeleteEmail={onDeleteEmail}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({
  group,
  isGenerating,
  emailCount,
  sentCount,
  selected,
  selectedFollowUps,
  onToggleSelect,
  onToggleSelectGroup,
  onToggleFollowUp,
  onReview,
  onRegenerate,
  onDeleteGroup,
  onDeleteRecipient,
  onDeleteEmail,
}) {
  const rows = [];
  let rowIndex = 0;
  const hrCount = group.recipients?.length || 0;

  // Group-level selection state for the "select all contacts" checkbox.
  const groupSendIds = [];
  const groupFollowIds = [];
  for (const recipient of group.recipients || []) {
    for (const email of getRecipientEmails(recipient)) {
      if (isEmailSendable(group, email)) groupSendIds.push(email.id);
      else if (isEmailFollowUpable(email)) groupFollowIds.push(email.id);
    }
  }
  const groupActionable = groupSendIds.length + groupFollowIds.length;
  const groupSelectedCount =
    groupSendIds.filter((id) => selected.has(id)).length +
    groupFollowIds.filter((id) => selectedFollowUps?.has(id)).length;
  const groupAllSelected = groupActionable > 0 && groupSelectedCount === groupActionable;
  const groupSomeSelected = groupSelectedCount > 0 && !groupAllSelected;

  for (const recipient of group.recipients || []) {
    const emails = getRecipientEmails(recipient);
    emails.forEach((email, emailIdx) => {
      rows.push({
        recipient,
        email,
        isFirstGroupRow: rowIndex === 0,
        isFirstHrRow: emailIdx === 0,
        emailIdx,
        hrEmailCount: emails.length,
      });
      rowIndex++;
    });
  }

  if (rows.length === 0) {
    return (
      <tr key={group.id} className="group-first">
        <td colSpan={6} className="muted">
          No HR contacts — use Review or add companies.
        </td>
      </tr>
    );
  }

  return rows.map(
    ({ recipient, email, isFirstGroupRow, isFirstHrRow, emailIdx, hrEmailCount }) => {
      const isReady = isEmailSendable(group, email);
      const canFollowUp = isEmailFollowUpable(email);

      return (
        <tr
          key={email.id}
          className={`${selected.has(email.id) || selectedFollowUps?.has(email.id) ? 'selected' : ''} ${isFirstGroupRow ? 'group-first' : 'group-cont'}`}
        >
          <td className="col-check">
            {canFollowUp ? (
              <input
                type="checkbox"
                checked={selectedFollowUps?.has(email.id) || false}
                onChange={() => onToggleFollowUp(email.id)}
                title="Select for follow-up"
                style={{ accentColor: '#7c3aed' }}
              />
            ) : (
              <input
                type="checkbox"
                checked={selected.has(email.id)}
                onChange={() => onToggleSelect(email.id)}
                disabled={!isReady}
                title={
                  email.emailValidation === 'invalid'
                    ? 'Fix or verify email before sending'
                    : isReady
                      ? ''
                      : 'Not ready to send'
                }
              />
            )}
          </td>
          <td>
            {isFirstGroupRow ? (
              <div className="company-select">
                <GroupSelectCheckbox
                  checked={groupAllSelected}
                  indeterminate={groupSomeSelected}
                  disabled={groupActionable === 0}
                  onChange={() => onToggleSelectGroup(group)}
                  title={
                    groupActionable === 0
                      ? 'No selectable contacts for this company'
                      : `Select all ${groupActionable} contact(s) for ${group.company}`
                  }
                />
                <div>
                  <div className="company">{group.company}</div>
                  {hrCount > 1 && <div className="muted small">{hrCount} HR contacts</div>}
                </div>
              </div>
            ) : null}
          </td>
          <td>{isFirstGroupRow ? group.role : null}</td>
          <td>
            {isFirstHrRow ? (
              <div>{recipient.hrName || <span className="muted">No HR name</span>}</div>
            ) : null}
            <div className="muted small">{email.address}</div>
            {hrEmailCount > 1 && emailIdx > 0 && (
              <div className="muted small">↳ additional email</div>
            )}
            <EmailValidationBadge
              status={email.emailValidation}
              message={email.emailValidationMessage}
            />
          </td>
          <td>
            <RowStatusBadge
              group={group}
              email={email}
              isGenerating={isGenerating && isFirstGroupRow}
              sentCount={sentCount}
              totalCount={emailCount}
              showGroupError={isFirstGroupRow}
            />
            {email.sentAt && (
              <div className="muted small">{new Date(email.sentAt).toLocaleString()}</div>
            )}
            {email.error && email.status === 'failed' && (
              <div className="error-msg small" title={email.error}>
                {truncate(email.error, 60)}
              </div>
            )}
            {email.status === 'sent' && (
              <FollowUpBadge email={email} />
            )}
          </td>
          <td className="col-actions">
            {isFirstGroupRow ? (
              <>
                <button
                  className="btn small"
                  onClick={() => onReview(group.id)}
                  title="Edit company, HR contacts, and cover letter"
                >
                  Review
                </button>
                <button
                  className="btn small ghost"
                  onClick={() => onRegenerate(group.id)}
                  disabled={isGenerating}
                  title="Regenerate cover letter (shared for all HRs at this company)"
                >
                  ↻
                </button>
                <button
                  className="btn small danger-ghost"
                  onClick={() => onDeleteGroup(group.id)}
                  title="Delete entire company application"
                >
                  ×
                </button>
              </>
            ) : (
              <button
                className="btn small danger-ghost"
                onClick={() =>
                  onDeleteEmail
                    ? onDeleteEmail(group.id, recipient.id, email.id)
                    : onDeleteRecipient(group.id, recipient.id)
                }
                title={
                  onDeleteEmail && hrEmailCount > 1
                    ? 'Remove this email'
                    : 'Remove this HR contact'
                }
              >
                ×
              </button>
            )}
          </td>
        </tr>
      );
    },
  );
}

function GroupSelectCheckbox({ checked, indeterminate, disabled, onChange, title }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !checked && Boolean(indeterminate);
  }, [checked, indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="group-check"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      title={title}
    />
  );
}

function RowStatusBadge({
  group,
  email,
  isGenerating,
  sentCount,
  totalCount,
  showGroupError,
}) {
  if (isGenerating) {
    return (
      <span className="badge badge-pending">
        <span className="spinner" /> generating…
      </span>
    );
  }

  if (email.status === 'sent') {
    return <span className="badge badge-sent">sent</span>;
  }
  if (email.status === 'failed') {
    return <span className="badge badge-failed">failed</span>;
  }

  if (group.status === 'reviewed') {
    return <span className="badge badge-reviewed">reviewed</span>;
  }

  if (sentCount > 0 && sentCount < totalCount && showGroupError) {
    return (
      <span className="badge badge-reviewed">
        {sentCount}/{totalCount} sent
      </span>
    );
  }

  return (
    <>
      <span className={`badge badge-${group.status}`}>{group.status}</span>
      {showGroupError && group.error && group.status !== 'failed' && (
        <div className="error-msg small" title={group.error}>
          {truncate(group.error, 60)}
        </div>
      )}
    </>
  );
}

function FollowUpBadge({ email }) {
  const count = followUpCount(email);
  const lastFailed = email.followUpStatus === 'failed';
  const lastDate = email.followUpSentAt
    ? new Date(email.followUpSentAt).toLocaleDateString()
    : '';

  return (
    <>
      {count > 0 && (
        <div className="muted small" style={{ color: '#7c3aed' }}>
          ↩ {count} follow-up{count > 1 ? 's' : ''} sent{lastDate ? ` · last ${lastDate}` : ''}
        </div>
      )}
      {lastFailed && (
        <div className="error-msg small" title={email.followUpError}>
          last follow-up failed
        </div>
      )}
      <div className="muted small" style={{ color: '#7c3aed' }}>
        ☑ select to follow up{count > 0 ? ' again' : ''}
      </div>
    </>
  );
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
