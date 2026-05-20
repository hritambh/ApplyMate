import { useRef } from 'react';

export default function ResumeCard({ resume, onUpload, onDelete }) {
  const inputRef = useRef(null);

  return (
    <div className="card resume-card">
      <h3>Resume</h3>
      {resume ? (
        <div className="resume-info">
          <div>
            <div className="filename">{resume.originalName}</div>
            <div className="meta">
              {formatBytes(resume.size)} · uploaded {new Date(resume.uploadedAt).toLocaleString()}
            </div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => inputRef.current?.click()}>
              Replace
            </button>
            <button className="btn danger-ghost" onClick={onDelete}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="resume-empty">
          <p>Upload your resume once — it will be attached to every email you send.</p>
          <button className="btn primary" onClick={() => inputRef.current?.click()}>
            Upload resume (PDF or DOCX)
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
