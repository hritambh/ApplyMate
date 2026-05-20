import { isGroupGenerating, isRecipientSendable } from '../api.js';
import EmailValidationBadge from './EmailValidationBadge.jsx';

export default function ApplicationsTable({
  applications,
  selected,
  onToggleSelect,
  onReview,
  onRegenerate,
  onDeleteGroup,
  onDeleteRecipient,
}) {
  if (applications.length === 0) {
    return (
      <div className="empty">
        <p>No applications yet. Click <strong>Add companies</strong> to get started.</p>
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
          {applications.map((group) => {
            const isGenerating = isGroupGenerating(group);
            const recipientCount = group.recipients?.length || 0;
            const sentCount = group.recipients?.filter((r) => r.status === 'sent').length || 0;

            return (
              <GroupRows
                key={group.id}
                group={group}
                isGenerating={isGenerating}
                recipientCount={recipientCount}
                sentCount={sentCount}
                selected={selected}
                onToggleSelect={onToggleSelect}
                onReview={onReview}
                onRegenerate={onRegenerate}
                onDeleteGroup={onDeleteGroup}
                onDeleteRecipient={onDeleteRecipient}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({
  group,
  isGenerating,
  recipientCount,
  sentCount,
  selected,
  onToggleSelect,
  onReview,
  onRegenerate,
  onDeleteGroup,
  onDeleteRecipient,
}) {
  const recipients = group.recipients || [];

  return recipients.map((recipient, idx) => {
    const isReady = isRecipientSendable(group, recipient);
    const isFirst = idx === 0;

    return (
      <tr
        key={recipient.id}
        className={`${selected.has(recipient.id) ? 'selected' : ''} ${isFirst ? 'group-first' : 'group-cont'}`}
      >
        <td className="col-check">
          <input
            type="checkbox"
            checked={selected.has(recipient.id)}
            onChange={() => onToggleSelect(recipient.id)}
            disabled={!isReady}
            title={
              recipient.emailValidation === 'invalid'
                ? 'Fix or verify email before sending'
                : isReady
                  ? ''
                  : 'Not ready to send'
            }
          />
        </td>
        <td>
          {isFirst ? (
            <>
              <div className="company">{group.company}</div>
              {recipientCount > 1 && (
                <div className="muted small">{recipientCount} HR contacts</div>
              )}
            </>
          ) : null}
        </td>
        <td>{isFirst ? group.role : null}</td>
        <td>
          <div>{recipient.hrName || <span className="muted">No HR name</span>}</div>
          <div className="muted small">{recipient.email}</div>
          <EmailValidationBadge
            status={recipient.emailValidation}
            message={recipient.emailValidationMessage}
          />
        </td>
        <td>
          <RowStatusBadge
            group={group}
            recipient={recipient}
            isGenerating={isGenerating && isFirst}
            sentCount={sentCount}
            totalCount={recipientCount}
            showGroupError={isFirst}
          />
          {recipient.sentAt && (
            <div className="muted small">{new Date(recipient.sentAt).toLocaleString()}</div>
          )}
          {recipient.error && recipient.status === 'failed' && (
            <div className="error-msg small" title={recipient.error}>
              {truncate(recipient.error, 60)}
            </div>
          )}
        </td>
        <td className="col-actions">
          {isFirst ? (
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
              onClick={() => onDeleteRecipient(group.id, recipient.id)}
              title="Remove this HR contact"
            >
              ×
            </button>
          )}
        </td>
      </tr>
    );
  });
}

function RowStatusBadge({
  group,
  recipient,
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

  if (recipient.status === 'sent') {
    return <span className="badge badge-sent">sent</span>;
  }
  if (recipient.status === 'failed') {
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

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
