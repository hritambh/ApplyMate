import { useState } from 'react';

const FLAT_EXAMPLE = `[
  {
    "company": "ABC Technologies",
    "role": "Backend Developer",
    "hrName": "John Doe",
    "email": "john@abc.com"
  },
  {
    "company": "ABC Technologies",
    "role": "Backend Developer",
    "hrName": "John Doe",
    "emails": ["john.personal@abc.com", "john.work@abc.com"]
  }
]`;

const GROUPED_EXAMPLE = `[
  {
    "company": "ABC Technologies",
    "role": "Backend Developer",
    "contacts": [
      {
        "hrName": "John Doe",
        "emails": ["john@abc.com", "john.alt@abc.com"]
      },
      { "hrName": "Jane Smith", "email": "jane@abc.com" }
    ]
  }
]`;

const BLANK_CONTACT = { hrName: '', emails: [''] };

const DEFAULT_ROLE = 'Backend Developer';

function newCompany() {
  return {
    id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()),
    company: '',
    role: DEFAULT_ROLE,
    contacts: [{ hrName: '', emails: [''] }],
  };
}

function contactEmails(contact) {
  return (contact.emails || [])
    .map((x) => String(x).trim())
    .filter(Boolean);
}

function flattenCompanies(companyBlocks) {
  const out = [];
  for (const block of companyBlocks) {
    const company = block.company.trim();
    const role = block.role.trim();
    const filledContacts = block.contacts.filter(
      (c) => c.hrName.trim() || contactEmails(c).length > 0,
    );

    if (!company && !role && filledContacts.length === 0) continue;

    if ((company || role) && filledContacts.length === 0) {
      throw new Error(
        company
          ? `Add at least one HR contact for ${company}`
          : 'Add at least one HR contact for each company',
      );
    }

    for (const c of filledContacts) {
      const emails = contactEmails(c);
      if (emails.length === 0) {
        throw new Error(
          company
            ? `Add at least one email for ${c.hrName.trim() || 'each HR contact'} at ${company}`
            : 'Add at least one email per HR contact',
        );
      }
      out.push({
        company,
        role,
        hrName: c.hrName.trim(),
        emails,
      });
    }
  }
  return out;
}

function parseContactEmails(c) {
  if (Array.isArray(c.emails)) {
    return c.emails.map((x) => String(x).trim()).filter(Boolean);
  }
  if (c.email) return [String(c.email).trim()];
  return [];
}

function parseJsonEntries(parsed) {
  if (!Array.isArray(parsed)) throw new Error('JSON must be an array');

  const out = [];
  for (const item of parsed) {
    if (Array.isArray(item.contacts)) {
      const company = String(item.company || '').trim();
      const role = String(item.role || '').trim();
      for (const c of item.contacts) {
        const emails = parseContactEmails(c);
        if (emails.length === 0) continue;
        out.push({
          company,
          role,
          hrName: String(c.hrName || '').trim(),
          emails,
        });
      }
    } else {
      const emails = parseContactEmails(item);
      if (emails.length === 0 && item.email) emails.push(String(item.email).trim());
      if (emails.length === 0) continue;
      out.push({
        company: String(item.company || '').trim(),
        role: String(item.role || '').trim(),
        hrName: String(item.hrName || '').trim(),
        emails,
      });
    }
  }
  return out;
}

function validateEntries(companies) {
  if (companies.length === 0) throw new Error('Add at least one company with one HR contact');

  const blocks = new Map();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  for (const c of companies) {
    if (!c.company || !c.role) {
      throw new Error('Every company needs a name and role');
    }
    if (!c.emails?.length) {
      throw new Error(`Add at least one email for every HR contact at ${c.company}`);
    }
    const key = `${c.company.toLowerCase()}::${c.role.toLowerCase()}`;
    if (!blocks.has(key)) blocks.set(key, new Set());
    const seen = blocks.get(key);

    for (const addr of c.emails) {
      if (!emailRe.test(addr)) {
        throw new Error(`Invalid email: ${addr}`);
      }
      const lower = addr.toLowerCase();
      if (seen.has(lower)) {
        throw new Error(`Duplicate email ${addr} for ${c.company}`);
      }
      seen.add(lower);
    }
  }
}

export default function BulkAddForm({ onClose, onSubmit, busy }) {
  const [mode, setMode] = useState('form');
  const [companyBlocks, setCompanyBlocks] = useState([newCompany()]);
  const [jsonText, setJsonText] = useState(GROUPED_EXAMPLE);
  const [error, setError] = useState(null);

  const addCompany = () => setCompanyBlocks((blocks) => [...blocks, newCompany()]);

  const removeCompany = (id) => {
    setCompanyBlocks((blocks) => {
      if (blocks.length === 1) return blocks;
      return blocks.filter((b) => b.id !== id);
    });
  };

  const updateCompany = (id, key, value) => {
    setCompanyBlocks((blocks) =>
      blocks.map((b) => (b.id === id ? { ...b, [key]: value } : b)),
    );
  };

  const addContact = (companyId) => {
    setCompanyBlocks((blocks) =>
      blocks.map((b) =>
        b.id === companyId
          ? { ...b, contacts: [...b.contacts, { hrName: '', emails: [''] }] }
          : b,
      ),
    );
  };

  const removeContact = (companyId, contactIndex) => {
    setCompanyBlocks((blocks) =>
      blocks.map((b) => {
        if (b.id !== companyId) return b;
        if (b.contacts.length === 1) return b;
        return {
          ...b,
          contacts: b.contacts.filter((_, i) => i !== contactIndex),
        };
      }),
    );
  };

  const updateContact = (companyId, contactIndex, key, value) => {
    setCompanyBlocks((blocks) =>
      blocks.map((b) => {
        if (b.id !== companyId) return b;
        return {
          ...b,
          contacts: b.contacts.map((c, i) =>
            i === contactIndex ? { ...c, [key]: value } : c,
          ),
        };
      }),
    );
  };

  const addContactEmail = (companyId, contactIndex) => {
    setCompanyBlocks((blocks) =>
      blocks.map((b) => {
        if (b.id !== companyId) return b;
        return {
          ...b,
          contacts: b.contacts.map((c, i) =>
            i === contactIndex ? { ...c, emails: [...c.emails, ''] } : c,
          ),
        };
      }),
    );
  };

  const removeContactEmail = (companyId, contactIndex, emailIndex) => {
    setCompanyBlocks((blocks) =>
      blocks.map((b) => {
        if (b.id !== companyId) return b;
        return {
          ...b,
          contacts: b.contacts.map((c, i) => {
            if (i !== contactIndex) return c;
            if (c.emails.length === 1) return c;
            return {
              ...c,
              emails: c.emails.filter((_, ei) => ei !== emailIndex),
            };
          }),
        };
      }),
    );
  };

  const updateContactEmail = (companyId, contactIndex, emailIndex, value) => {
    setCompanyBlocks((blocks) =>
      blocks.map((b) => {
        if (b.id !== companyId) return b;
        return {
          ...b,
          contacts: b.contacts.map((c, i) => {
            if (i !== contactIndex) return c;
            return {
              ...c,
              emails: c.emails.map((em, ei) => (ei === emailIndex ? value : em)),
            };
          }),
        };
      }),
    );
  };

  const submit = () => {
    setError(null);
    try {
      let companies;
      if (mode === 'form') {
        companies = flattenCompanies(companyBlocks);
      } else {
        const parsed = JSON.parse(jsonText);
        companies = parseJsonEntries(parsed);
      }
      validateEntries(companies);
      onSubmit(companies);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal bulk-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Add companies</h2>
          <div className="tabs">
            <button
              className={`tab ${mode === 'form' ? 'active' : ''}`}
              onClick={() => setMode('form')}
            >
              Form
            </button>
            <button
              className={`tab ${mode === 'json' ? 'active' : ''}`}
              onClick={() => setMode('json')}
            >
              Paste JSON
            </button>
          </div>
        </header>

        <div className="modal-body">
          {mode === 'form' ? (
            <div className="company-blocks">
              <p className="hint">
                Add a company and role once, then list HR contacts. Each contact can have multiple
                email addresses — each is validated and sent separately.
              </p>

              {companyBlocks.map((block, blockIndex) => (
                <div className="company-card" key={block.id}>
                  <div className="company-card-header">
                    <span className="company-card-title">Company {blockIndex + 1}</span>
                    <button
                      type="button"
                      className="btn small danger-ghost"
                      onClick={() => removeCompany(block.id)}
                      disabled={companyBlocks.length === 1}
                      title="Remove company"
                    >
                      Remove company
                    </button>
                  </div>

                  <div className="company-fields">
                    <label>
                      <span>Company name</span>
                      <input
                        placeholder="e.g. ABC Technologies"
                        value={block.company}
                        onChange={(e) => updateCompany(block.id, 'company', e.target.value)}
                      />
                    </label>
                    <label>
                      <span>Role / title</span>
                      <input
                        placeholder="e.g. Backend Developer"
                        value={block.role}
                        onChange={(e) => updateCompany(block.id, 'role', e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="contacts-section">
                    <span className="section-label">HR contacts</span>
                    {block.contacts.map((contact, ci) => (
                      <div className="contact-card" key={ci}>
                        <input
                          className="contact-name"
                          placeholder="HR name (optional)"
                          value={contact.hrName}
                          onChange={(e) =>
                            updateContact(block.id, ci, 'hrName', e.target.value)
                          }
                        />
                        <div className="contact-emails">
                          {contact.emails.map((em, ei) => (
                            <div className="contact-email-row" key={ei}>
                              <input
                                placeholder="HR email"
                                value={em}
                                onChange={(e) =>
                                  updateContactEmail(block.id, ci, ei, e.target.value)
                                }
                              />
                              <button
                                type="button"
                                className="btn danger-ghost"
                                onClick={() => removeContactEmail(block.id, ci, ei)}
                                disabled={contact.emails.length === 1}
                                title="Remove email"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="btn small ghost"
                            onClick={() => addContactEmail(block.id, ci)}
                          >
                            + Add email
                          </button>
                        </div>
                        <button
                          type="button"
                          className="btn small danger-ghost remove-contact"
                          onClick={() => removeContact(block.id, ci)}
                          disabled={block.contacts.length === 1}
                          title="Remove contact"
                        >
                          Remove contact
                        </button>
                      </div>
                    ))}
                    <button type="button" className="btn small" onClick={() => addContact(block.id)}>
                      + Add contact
                    </button>
                  </div>
                </div>
              ))}

              <button type="button" className="btn primary-outline" onClick={addCompany}>
                + Add company
              </button>
            </div>
          ) : (
            <>
              <p className="hint">
                Grouped format:{' '}
                <code>{`{ company, role, contacts: [{ hrName, emails: [...] }] }`}</code>
                <br />
                Single <code>email</code> per contact still works. Flat rows can use{' '}
                <code>emails</code> array too.
              </p>
              <textarea
                className="json-input"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                spellCheck={false}
                rows={14}
              />
              <button
                type="button"
                className="btn small ghost"
                onClick={() => setJsonText(GROUPED_EXAMPLE)}
              >
                Use grouped example
              </button>
              <button
                type="button"
                className="btn small ghost"
                onClick={() => setJsonText(FLAT_EXAMPLE)}
              >
                Use flat example
              </button>
            </>
          )}

          {error && <div className="banner banner-error inline">{error}</div>}
        </div>

        <footer className="modal-footer">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Adding…' : 'Add & generate cover letters'}
          </button>
        </footer>
      </div>
    </div>
  );
}
